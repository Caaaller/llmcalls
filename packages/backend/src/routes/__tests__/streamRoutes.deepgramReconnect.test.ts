/**
 * Integration test: Deepgram STT WebSocket reconnect logic.
 *
 * Scenario: Deepgram WS dies mid-call (code 1006). The backend should
 * reconnect with exponential backoff (250ms, 750ms, 2000ms), buffer audio
 * frames during the gap, drain them on reopen, and surface telemetry
 * (dg_reconnects, dg_silent_ms) on the call state.
 *
 * We spin up a mock Deepgram WS server on a random port and point the
 * backend at it via DEEPGRAM_WS_URL_OVERRIDE. Then we connect as a Telnyx
 * media-streaming client to the backend's /voice/stream endpoint and drive
 * the lifecycle: start → media → (kill mock) → media buffered → reconnect →
 * transcript flows through again.
 */

import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';
import { WebSocket as WS, WebSocketServer } from 'ws';

// Mock processSpeech BEFORE importing streamRoutes so the spy is in place.
const processSpeechMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/speechProcessingService', () => ({
  processSpeech: (...args: Array<unknown>) => processSpeechMock(...args),
}));

// Mock callHistoryService — we never want to touch MongoDB in this test.
jest.mock('../../services/callHistoryService', () => ({
  __esModule: true,
  default: {
    addHoldDetected: jest.fn().mockResolvedValue(undefined),
  },
}));

import { attachStreamServer, getReconnectTelemetry } from '../streamRoutes';
import debugRoutes from '../debugRoutes';
import callStateManager from '../../services/callStateManager';

// --- Mock Deepgram server ----------------------------------------------------

interface MockDeepgram {
  wss: WebSocketServer;
  port: number;
  connections: Array<WS>;
  /** Per-connection acceptance: true = accept WS, false = immediately close. */
  acceptNext: Array<boolean>;
  framesReceived: number;
  close: () => Promise<void>;
}

async function startMockDeepgram(): Promise<MockDeepgram> {
  const wss = new WebSocketServer({ port: 0 });
  const mock: MockDeepgram = {
    wss,
    port: (wss.address() as AddressInfo).port,
    connections: [],
    acceptNext: [],
    framesReceived: 0,
    close: async () => {
      await new Promise<void>(resolve => wss.close(() => resolve()));
    },
  };

  wss.on('connection', (ws: WS) => {
    const shouldAccept = mock.acceptNext.shift() ?? true;
    if (!shouldAccept) {
      // Simulate a server that refuses — terminate immediately with 1006.
      ws.terminate();
      return;
    }
    mock.connections.push(ws);
    ws.on('message', data => {
      if (Buffer.isBuffer(data)) mock.framesReceived += 1;
    });
  });

  await new Promise<void>(resolve => wss.on('listening', () => resolve()));
  return mock;
}

// --- Mock Telnyx client ------------------------------------------------------

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

// --- Harness -----------------------------------------------------------------

interface Harness {
  httpServer: http.Server;
  baseUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

async function startBackendHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use('/debug', debugRoutes);
  const httpServer = http.createServer(app);
  attachStreamServer(httpServer);

  await new Promise<void>(resolve =>
    httpServer.listen(0, '127.0.0.1', () => resolve())
  );
  const { port } = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/voice/stream`;

  return {
    httpServer,
    baseUrl,
    wsUrl,
    close: async () => {
      await new Promise<void>(resolve => httpServer.close(() => resolve()));
    },
  };
}

function sendStart(ws: WS, callSid: string): void {
  ws.send(
    JSON.stringify({
      event: 'start',
      start: { call_control_id: callSid },
    })
  );
}

function sendMedia(ws: WS, payloadBytes: Buffer): void {
  ws.send(
    JSON.stringify({
      event: 'media',
      media: { track: 'inbound', payload: payloadBytes.toString('base64') },
    })
  );
}

// --- Tests -------------------------------------------------------------------

describe('Deepgram WS reconnect', () => {
  const originalUrl = process.env.DEEPGRAM_WS_URL_OVERRIDE;
  const originalKey = process.env.DEEPGRAM_API_KEY;

  beforeAll(() => {
    process.env.DEEPGRAM_API_KEY = 'test-key';
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DEEPGRAM_WS_URL_OVERRIDE;
    else process.env.DEEPGRAM_WS_URL_OVERRIDE = originalUrl;
    if (originalKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = originalKey;
  });

  beforeEach(() => {
    processSpeechMock.mockClear();
  });

  it('reconnects after abnormal close, buffers audio during gap, drains on reopen', async () => {
    const dg = await startMockDeepgram();
    process.env.DEEPGRAM_WS_URL_OVERRIDE = `ws://127.0.0.1:${dg.port}/`;

    const harness = await startBackendHarness();
    const callSid = 'test-call-reconnect-1';

    const client = new WS(harness.wsUrl);
    await new Promise<void>(resolve => client.on('open', () => resolve()));

    sendStart(client, callSid);
    await waitFor(() => dg.connections.length === 1);

    // Baseline: media frame flows through to Deepgram mock.
    sendMedia(client, Buffer.from([0x01, 0x02, 0x03]));
    await waitFor(() => dg.framesReceived >= 1);

    // Force 1006 abnormal close from the mock side.
    const framesBeforeKill = dg.framesReceived;
    dg.connections[0].terminate();

    // Send media during the reconnect gap — these must be buffered, not dropped.
    await waitFor(
      () =>
        dg.connections.length === 1 && dg.connections[0].readyState !== WS.OPEN,
      2000,
      5
    ).catch(() => {});
    sendMedia(client, Buffer.from([0x10, 0x11, 0x12]));
    sendMedia(client, Buffer.from([0x20, 0x21, 0x22]));

    // Wait for the backend to reconnect (first attempt after 250ms).
    await waitFor(() => dg.connections.length === 2, 2000);

    // Buffered frames should be drained on reopen. Baseline was framesBeforeKill (>=1);
    // after reconnect we should see at least 2 additional frames.
    await waitFor(() => dg.framesReceived >= framesBeforeKill + 2, 2000);

    // Simulate Deepgram emitting a transcript on the NEW connection.
    const newConn = dg.connections[1];
    newConn.send(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        speech_final: true,
        start: 0,
        duration: 1,
        channel: {
          alternatives: [{ transcript: 'hello after reconnect world' }],
        },
      })
    );

    // Assert it reaches the processSpeech consumer.
    // Give an action-history entry so silentHoldTimer gating doesn't matter;
    // processSpeech is called regardless of that gate.
    await waitFor(() => processSpeechMock.mock.calls.length >= 1, 2000);
    const firstCallArg = processSpeechMock.mock.calls[0][0] as {
      callSid: string;
      speechResult: string;
    };
    expect(firstCallArg.callSid).toBe(callSid);
    expect(firstCallArg.speechResult).toBe('hello after reconnect world');

    // Telemetry: one reconnect, non-zero silent window.
    const telem = getReconnectTelemetry(callSid);
    expect(telem).not.toBeNull();
    expect(telem!.dg_reconnects).toBe(1);
    expect(telem!.dg_silent_ms).toBeGreaterThan(0);

    // Cleanup
    client.close();
    await harness.close();
    await dg.close();
  }, 15000);

  it('gives up after 3 failed reconnect attempts and logs loudly', async () => {
    // Pick a port that's free, grab it, then release it — so connections
    // to that port will reliably get ECONNREFUSED.
    const probe = await startMockDeepgram();
    const deadPort = probe.port;
    await probe.close();
    // Small delay to make sure the port is fully released.
    await new Promise(r => setTimeout(r, 50));

    process.env.DEEPGRAM_WS_URL_OVERRIDE = `ws://127.0.0.1:${deadPort}/`;

    const harness = await startBackendHarness();
    const callSid = 'test-call-reconnect-giveup';

    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const client = new WS(harness.wsUrl);
    await new Promise<void>(resolve => client.on('open', () => resolve()));

    // Sending `start` triggers openDeepgram — immediate failure, then the
    // reconnect loop kicks in and exhausts all 3 attempts against the dead port.
    sendStart(client, callSid);

    // 250 + 750 + 2000 = 3000ms of backoff; allow margin for connect timeouts.
    await waitFor(
      () =>
        errorSpy.mock.calls.some(call =>
          String(call[0] ?? '').includes('Deepgram reconnect FAILED')
        ),
      15000
    );

    const telem = getReconnectTelemetry(callSid);
    expect(telem!.dg_reconnects).toBe(3);

    const cs = callStateManager.getCallState(callSid) as unknown as {
      dg_reconnects?: number;
    };
    expect(cs.dg_reconnects).toBe(3);

    errorSpy.mockRestore();
    client.close();
    await harness.close();
  }, 25000);

  it('debug endpoint force-closes Deepgram WS and triggers reconnect', async () => {
    const dg = await startMockDeepgram();
    process.env.DEEPGRAM_WS_URL_OVERRIDE = `ws://127.0.0.1:${dg.port}/`;

    const harness = await startBackendHarness();
    const callSid = 'test-call-debug-kill';

    const client = new WS(harness.wsUrl);
    await new Promise<void>(resolve => client.on('open', () => resolve()));
    sendStart(client, callSid);
    await waitFor(() => dg.connections.length === 1);

    // Hit the debug endpoint
    const res = await fetch(
      `${harness.baseUrl}/debug/kill-deepgram-ws/${callSid}`,
      { method: 'POST' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // Backend should reconnect.
    await waitFor(() => dg.connections.length === 2, 2000);

    const telem = getReconnectTelemetry(callSid);
    expect(telem!.dg_reconnects).toBe(1);

    client.close();
    await harness.close();
    await dg.close();
  }, 10000);

  it('debug endpoint returns 404 in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const harness = await startBackendHarness();
    const res = await fetch(
      `${harness.baseUrl}/debug/kill-deepgram-ws/anything`,
      { method: 'POST' }
    );
    expect(res.status).toBe(404);

    await harness.close();
    process.env.NODE_ENV = originalEnv;
  }, 5000);
});
