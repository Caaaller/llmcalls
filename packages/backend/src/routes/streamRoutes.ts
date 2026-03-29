/**
 * Stream Routes — Telnyx Media Streaming WebSocket Handler
 * Receives raw audio from Telnyx, transcribes with OpenAI Whisper,
 * and calls processSpeech() on utterance completion.
 */

import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import OpenAI from 'openai';
import { Readable } from 'stream';
import callStateManager from '../services/callStateManager';
import { processSpeech } from '../services/speechProcessingService';
import { toError } from '../utils/errorUtils';

// μ-law expansion table (PCMU → 16-bit PCM)
const ULAW_TABLE = buildUlawTable();

function buildUlawTable(): Int16Array {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const ulaw = ~i;
    const sign = ulaw & 0x80;
    const exponent = (ulaw >> 4) & 0x07;
    const mantissa = ulaw & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    table[i] = sign ? -sample : sample;
  }
  return table;
}

function pcmuToPcm16(pcmuBytes: Buffer): Buffer {
  const pcm = Buffer.alloc(pcmuBytes.length * 2);
  for (let i = 0; i < pcmuBytes.length; i++) {
    const sample = ULAW_TABLE[pcmuBytes[i]];
    pcm.writeInt16LE(sample, i * 2);
  }
  return pcm;
}

function buildWavBuffer(pcm16: Buffer, sampleRate = 8000): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm16.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}

function rmsEnergy(pcm16: Buffer): number {
  let sum = 0;
  for (let i = 0; i < pcm16.length - 1; i += 2) {
    const s = pcm16.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / (pcm16.length / 2));
}

interface StreamState {
  callControlId: string;
  audioChunks: Buffer[];
  silentMs: number;
  lastFlushAt: number;
  processing: boolean;
}

const SILENCE_RMS_THRESHOLD = 300;
const SILENCE_DURATION_MS = 4000; // flush after 4s of silence (avoids intra-menu pauses ~3s)
const CHUNK_DURATION_MS = 20; // each PCMU packet = 20ms at 8kHz (160 bytes)
const MIN_AUDIO_MS = 300; // ignore utterances shorter than 300ms
const MAX_UTTERANCE_MS = 30000; // force flush after 30s even without silence

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcribeAudio(pcmChunks: Buffer[]): Promise<string> {
  const allPcm = Buffer.concat(pcmChunks);
  const wav = buildWavBuffer(allPcm);

  // OpenAI file upload expects a File-like object; wrap Buffer as Readable
  const readable = Readable.from(wav);
  const file = await OpenAI.toFile(readable, 'audio.wav', {
    type: 'audio/wav',
  });

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
  });
  return result.text.trim();
}

async function flushUtterance(state: StreamState): Promise<void> {
  if (state.processing || state.audioChunks.length === 0) return;

  const chunks = state.audioChunks.splice(0);
  const durationMs = chunks.length * CHUNK_DURATION_MS;
  if (durationMs < MIN_AUDIO_MS) return;

  const callState = callStateManager.getCallState(state.callControlId);
  if (callState.isSpeaking) {
    return; // Suppress TTS echo — discard
  }

  state.processing = true;
  try {
    const transcript = await transcribeAudio(chunks);
    console.log(`[STREAM-STT] "${transcript}" (${durationMs}ms audio)`);
    if (!transcript) return;

    await processSpeech({
      callSid: state.callControlId,
      speechResult: transcript,
      isFirstCall: false,
      baseUrl: '',
      transferNumber: callState.transferConfig?.transferNumber,
      callPurpose: callState.transferConfig?.callPurpose,
      customInstructions: callState.customInstructions,
      userPhone: callState.userPhone,
      skipInfoRequests: callState.skipInfoRequests,
    });
  } catch (err) {
    console.error('[STREAM-STT] Error:', toError(err).message);
  } finally {
    state.processing = false;
  }
}

function handleMediaMessage(
  state: StreamState,
  payload: string // base64 PCMU
): void {
  const pcmuBytes = Buffer.from(payload, 'base64');
  const pcm16 = pcmuToPcm16(pcmuBytes);
  const energy = rmsEnergy(pcm16);
  const isSilent = energy < SILENCE_RMS_THRESHOLD;

  if (!isSilent) {
    state.audioChunks.push(pcm16);
    state.silentMs = 0;
  } else {
    // Still accumulate during short silences (avoid cutting mid-word)
    if (state.audioChunks.length > 0) {
      state.audioChunks.push(pcm16);
      state.silentMs += CHUNK_DURATION_MS;

      if (state.silentMs >= SILENCE_DURATION_MS) {
        void flushUtterance(state);
        state.silentMs = 0;
      }
    }
  }

  // Force flush if utterance is too long (e.g. looping IVR with no silence)
  const currentMs = state.audioChunks.length * CHUNK_DURATION_MS;
  if (!state.processing && currentMs >= MAX_UTTERANCE_MS) {
    void flushUtterance(state);
    state.silentMs = 0;
  }
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
          audioChunks: [],
          silentMs: 0,
          lastFlushAt: Date.now(),
          processing: false,
        };
      } else if (event === 'media' && state) {
        const mediaData = msg.media as Record<string, unknown> | undefined;
        const track = (mediaData?.track as string) || '';
        if (track !== 'inbound') return; // Only transcribe IVR audio
        const payload = (mediaData?.payload as string) || '';
        if (payload) handleMediaMessage(state, payload);
      } else if (event === 'stop' && state) {
        // Flush any remaining audio
        void flushUtterance(state);
        console.log(`[STREAM] Stopped for ${state.callControlId.slice(-20)}`);
        state = null;
      }
    });

    ws.on('error', err => {
      console.error('[STREAM] WebSocket error:', err.message);
    });
  });

  console.log('  ✅ /voice/stream WebSocket server attached');
}
