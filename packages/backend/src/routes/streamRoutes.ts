/**
 * Stream Routes — Telnyx Media Streaming WebSocket Handler
 * Receives raw audio from Telnyx, transcribes with Deepgram nova-2-phonecall,
 * and calls processSpeech() on utterance completion.
 *
 * Uses raw WebSocket to Deepgram (Deepgram v5 SDK connect() is broken for Node).
 */

import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { WebSocketServer, WebSocket as WS } from 'ws';
import type { Server } from 'http';
import callStateManager from '../services/callStateManager';
import { processSpeech } from '../services/speechProcessingService';
import { toError } from '../utils/errorUtils';

const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-2-phonecall' +
  '&encoding=mulaw' +
  '&sample_rate=8000' +
  '&channels=1' +
  '&language=en-US' +
  '&smart_format=true' +
  '&utterance_end_ms=1200' +
  '&interim_results=true';

interface DeepgramResult {
  type: 'Results';
  is_final: boolean;
  channel: { alternatives: Array<{ transcript: string }> };
}

interface DeepgramUtteranceEnd {
  type: 'UtteranceEnd';
}

interface StreamState {
  callControlId: string;
  dgWs: WS | null;
  audioBuffer: Buffer[];
  transcript: string;
}

function openDeepgram(
  state: StreamState,
  onUtterance: (text: string) => Promise<void>
): void {
  const key = process.env.DEEPGRAM_API_KEY || '';
  const dgWs = new WS(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${key}` },
  });

  dgWs.on('open', () => {
    state.dgWs = dgWs;
    console.log(
      `[STREAM-STT] Deepgram open, draining ${state.audioBuffer.length} buffered frames`
    );
    for (const chunk of state.audioBuffer) dgWs.send(chunk);
    state.audioBuffer = [];
  });

  dgWs.on('message', (data: Buffer) => {
    let msg: DeepgramResult | DeepgramUtteranceEnd;
    try {
      msg = JSON.parse(data.toString()) as
        | DeepgramResult
        | DeepgramUtteranceEnd;
    } catch {
      return;
    }

    if (msg.type === 'Results') {
      const r = msg as DeepgramResult;
      const text = r.channel?.alternatives?.[0]?.transcript ?? '';
      if (r.is_final && text) {
        state.transcript += (state.transcript ? ' ' : '') + text;
      }
    } else if (msg.type === 'UtteranceEnd') {
      const text = state.transcript.trim();
      state.transcript = '';
      if (text) void onUtterance(text);
    }
  });

  dgWs.on('error', (err: Error) => {
    console.error(
      `[STREAM-STT] Deepgram WS error (${state.callControlId.slice(-10)}):`,
      err.message
    );
  });

  dgWs.on('close', (code: number) => {
    console.log(`[STREAM-STT] Deepgram WS closed (code=${code})`);
  });
}

export function attachStreamServer(httpServer: Server): void {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/voice/stream',
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    let state: StreamState | null = null;

    ws.on('message', (data: Buffer | string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const event = msg.event as string;

      if (event === 'start') {
        const startData = msg.start as Record<string, unknown> | undefined;
        const callControlId = (startData?.call_control_id as string) || '';
        console.log(`[STREAM] Started for ${callControlId.slice(-20)}`);

        state = {
          callControlId,
          dgWs: null,
          audioBuffer: [],
          transcript: '',
        };

        openDeepgram(state, async text => {
          const callState = callStateManager.getCallState(callControlId);
          if (callState.isSpeaking) return;

          console.log(`[STREAM-STT] "${text}"`);
          try {
            await processSpeech({
              callSid: callControlId,
              speechResult: text,
              isFirstCall: false,
              baseUrl: '',
              transferNumber: callState.transferConfig?.transferNumber,
              callPurpose: callState.transferConfig?.callPurpose,
              customInstructions: callState.customInstructions,
              userPhone: callState.userPhone,
              skipInfoRequests: callState.skipInfoRequests,
            });
          } catch (err) {
            console.error(
              '[STREAM-STT] processSpeech error:',
              toError(err).message
            );
          }
        });
      } else if (event === 'media' && state) {
        const mediaData = msg.media as Record<string, unknown> | undefined;
        const track = (mediaData?.track as string) || '';
        if (track !== 'inbound') return;
        const payload = (mediaData?.payload as string) || '';
        if (!payload) return;

        const pcmuBytes = Buffer.from(payload, 'base64');
        if (state.dgWs?.readyState === WS.OPEN) {
          state.dgWs.send(pcmuBytes);
        } else {
          state.audioBuffer.push(pcmuBytes);
        }
      } else if (event === 'stop' && state) {
        if (state.dgWs?.readyState === WS.OPEN) {
          state.dgWs.close();
        }
        console.log(`[STREAM] Stopped for ${state.callControlId.slice(-20)}`);
        state = null;
      }
    });

    ws.on('error', err => {
      console.error('[STREAM] WebSocket error:', err.message);
    });

    ws.on('close', () => {
      if (state?.dgWs?.readyState === WS.OPEN) {
        state.dgWs.close();
        state = null;
      }
    });
  });

  console.log('  ✅ /voice/stream WebSocket server attached');
}
