/**
 * Stream Routes — Telnyx Media Streaming WebSocket Handler
 * Receives raw audio from Telnyx, transcribes with Deepgram nova-2-phonecall,
 * and calls processSpeech() on utterance completion.
 */

import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { DeepgramClient } from '@deepgram/sdk';
import type { listen as ListenNS } from '@deepgram/sdk';
import callStateManager from '../services/callStateManager';
import { processSpeech } from '../services/speechProcessingService';
import { toError } from '../utils/errorUtils';

type V1Socket = Awaited<
  ReturnType<InstanceType<typeof DeepgramClient>['listen']['v1']['connect']>
>;
type V1Response =
  | ListenNS.ListenV1Results
  | ListenNS.ListenV1UtteranceEnd
  | ListenNS.ListenV1Metadata
  | ListenNS.ListenV1SpeechStarted;

interface StreamState {
  callControlId: string;
  dgSocket: V1Socket | null; // null while connecting
  audioBuffer: Buffer[]; // holds frames received before socket is ready
  transcript: string;
}

async function connectDeepgram(
  state: StreamState,
  onUtterance: (text: string) => Promise<void>
): Promise<void> {
  const dg = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY || '' });

  const socket = await dg.listen.v1.connect({
    Authorization: `Token ${process.env.DEEPGRAM_API_KEY || ''}`,
    model: 'nova-2-phonecall',
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    language: 'en-US',
    smart_format: 'true',
    utterance_end_ms: '1200',
    interim_results: 'true',
  });

  socket.on('message', (msg: V1Response) => {
    if (msg.type === 'Results') {
      const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (msg.is_final && text) {
        state.transcript += (state.transcript ? ' ' : '') + text;
      }
    } else if (msg.type === 'UtteranceEnd') {
      const text = state.transcript.trim();
      state.transcript = '';
      if (text) void onUtterance(text);
    }
  });

  socket.on('error', (err: Error) => {
    console.error(
      `[STREAM-STT] Deepgram error (${state.callControlId.slice(-10)}):`,
      err.message
    );
  });

  // Socket ready — drain any buffered audio
  state.dgSocket = socket;
  console.log(
    `[STREAM-STT] Deepgram connected, draining ${state.audioBuffer.length} buffered frames`
  );
  for (const chunk of state.audioBuffer) {
    socket.sendMedia(chunk);
  }
  state.audioBuffer = [];
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
          dgSocket: null,
          audioBuffer: [],
          transcript: '',
        };

        void connectDeepgram(state, async text => {
          const callState = callStateManager.getCallState(callControlId);
          if (callState.isSpeaking) return; // suppress TTS echo

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
        }).catch(err => {
          console.error(
            '[STREAM] Failed to connect to Deepgram:',
            toError(err).message
          );
        });
      } else if (event === 'media' && state) {
        const mediaData = msg.media as Record<string, unknown> | undefined;
        const track = (mediaData?.track as string) || '';
        if (track !== 'inbound') return; // only transcribe IVR audio
        const payload = (mediaData?.payload as string) || '';
        if (!payload) return;

        const pcmuBytes = Buffer.from(payload, 'base64');
        if (state.dgSocket) {
          // Socket ready — send directly
          state.dgSocket.sendMedia(pcmuBytes);
        } else {
          // Socket still connecting — buffer
          state.audioBuffer.push(pcmuBytes);
        }
      } else if (event === 'stop' && state) {
        if (state.dgSocket) {
          state.dgSocket.sendCloseStream({ type: 'CloseStream' });
        }
        console.log(`[STREAM] Stopped for ${state.callControlId.slice(-20)}`);
        state = null;
      }
    });

    ws.on('error', err => {
      console.error('[STREAM] WebSocket error:', err.message);
    });

    ws.on('close', () => {
      if (state?.dgSocket) {
        state.dgSocket.sendCloseStream({ type: 'CloseStream' });
        state = null;
      }
    });
  });

  console.log('  ✅ /voice/stream WebSocket server attached');
}
