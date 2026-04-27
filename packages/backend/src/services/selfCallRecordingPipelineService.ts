/**
 * Self-Call Recording Pipeline Service — Workaround for Issue #D
 *
 * The Telnyx cross-app WebSocket stream fork delivers garbage audio on
 * bridged self-calls (see docs/telnyx-cross-app-stream-fork-bug.md).
 * The Telnyx recording for the same call is fine, so we can verify the
 * AI's human-detection state machine end-to-end against real Telnyx
 * audio by:
 *
 *   1. Letting the call run with no live stream-fork dependency.
 *   2. After `call.recording.saved`, fetching the MP3 download URL.
 *   3. Sending the MP3 to Deepgram REST `nova-3` for transcription
 *      (same pipeline already used by `evaluateTimestamps.ts`).
 *   4. Splitting the resulting word stream into chunks roughly
 *      corresponding to "agent turn 1 (greeting)" and "agent turn 2
 *      (confirmation)" by gap heuristic.
 *   5. Replaying each chunk through `processSpeech` as if it had
 *      arrived live, asserting the state machine transitions.
 *
 * Limitation: human detection happens AFTER the call ends. Useless for
 * production transfers — fine for verifying the detection pipeline
 * works against real Telnyx audio. Gated behind ENABLE_SELF_CALL_SIMULATOR.
 */
import fs from 'fs';
import callStateManager from './callStateManager';
import { processSpeech, ProcessSpeechResult } from './speechProcessingService';
import { toError } from '../utils/errorUtils';

export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
}

export interface RecordingTranscriptionResult {
  words: ReadonlyArray<DeepgramWord>;
  duration: number;
}

export interface RecordingChunk {
  text: string;
  startSec: number;
  endSec: number;
}

export interface ReplayStepResult {
  chunk: RecordingChunk;
  result: ProcessSpeechResult;
}

/**
 * Resolve a recording reference to a downloadable URL.
 *
 * Accepts either:
 *   - A `telnyx:<recordingId>` reference (resolved via Telnyx recording API)
 *   - A direct https URL (returned unchanged)
 */
export async function resolveRecordingDownloadUrl(
  recordingRef: string
): Promise<string> {
  if (!recordingRef.startsWith('telnyx:')) return recordingRef;
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) throw new Error('TELNYX_API_KEY missing');
  const recordingId = recordingRef.replace('telnyx:', '');
  const res = await fetch(
    `https://api.telnyx.com/v2/recordings/${recordingId}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!res.ok) {
    throw new Error(
      `Telnyx recording metadata fetch failed: HTTP ${res.status}`
    );
  }
  const body = (await res.json()) as {
    data: { download_urls: { mp3: string; wav?: string } };
  };
  return body.data.download_urls.mp3;
}

export async function fetchAudio(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Audio fetch failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface DeepgramRestResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ words?: DeepgramWord[] }>;
    }>;
  };
}

export async function transcribeRecording(
  audio: Buffer
): Promise<RecordingTranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY missing');
  const params = new URLSearchParams({
    model: 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
  });
  const res = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'audio/mpeg',
      },
      body: audio,
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Deepgram HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as DeepgramRestResponse;
  const words = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const duration = json.metadata?.duration ?? 0;
  return { words, duration };
}

/**
 * Group Deepgram words into utterance chunks by gap heuristic. A gap
 * larger than `gapThresholdSec` between successive words ends a chunk.
 *
 * 0.7s default matches our live endpointing window.
 */
export function splitWordsIntoChunks(
  words: ReadonlyArray<DeepgramWord>,
  gapThresholdSec: number = 0.7
): RecordingChunk[] {
  if (words.length === 0) return [];

  const chunks: RecordingChunk[] = [];
  let bufferText: string[] = [];
  let bufferStart = words[0].start;
  let bufferEnd = words[0].end;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prevEnd = i === 0 ? w.start : words[i - 1].end;
    const gap = w.start - prevEnd;

    if (i > 0 && gap >= gapThresholdSec) {
      chunks.push({
        text: bufferText.join(' '),
        startSec: bufferStart,
        endSec: bufferEnd,
      });
      bufferText = [];
      bufferStart = w.start;
    }
    bufferText.push(w.punctuated_word ?? w.word);
    bufferEnd = w.end;
  }

  if (bufferText.length > 0) {
    chunks.push({
      text: bufferText.join(' '),
      startSec: bufferStart,
      endSec: bufferEnd,
    });
  }

  return chunks;
}

export interface ReplayParams {
  callSid: string;
  chunks: ReadonlyArray<RecordingChunk>;
  baseUrl: string;
  transferNumber?: string;
  callPurpose?: string;
}

/**
 * Replay each chunk through processSpeech sequentially, mimicking the
 * live state-machine progression. After a `maybe_human` action fires,
 * sets `awaitingHumanConfirmation` so the next chunk can upgrade to
 * `human_detected` (this matches the live voiceRoutes flow).
 *
 * Returns the per-chunk results in order.
 */
export async function replayChunksThroughStateMachine({
  callSid,
  chunks,
  baseUrl,
  transferNumber,
  callPurpose,
}: ReplayParams): Promise<ReplayStepResult[]> {
  callStateManager.getCallState(callSid);
  const results: ReplayStepResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.text.trim()) continue;

    const result = await processSpeech({
      callSid,
      speechResult: chunk.text,
      isFirstCall: false,
      baseUrl,
      transferNumber,
      callPurpose: callPurpose ?? 'speak with a representative',
      testMode: true,
    });

    results.push({ chunk, result });

    if (result.aiAction === 'maybe_human') {
      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: true,
      });
    }

    // Stop early on a terminal action — matches live behavior where the
    // call would be transferred and no further speech would be processed.
    if (
      result.aiAction === 'transfer' ||
      result.aiAction === 'human_detected'
    ) {
      break;
    }
  }

  return results;
}

/**
 * Read a fixture MP3 from disk. Used by tests that don't want to hit
 * the Telnyx recording API.
 */
export function readFixtureRecording(absolutePath: string): Buffer {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Fixture recording not found: ${absolutePath}`);
  }
  return fs.readFileSync(absolutePath);
}

/**
 * Top-level orchestration for the recording-API workaround. Used by
 * the call.recording.saved webhook handler when
 * ENABLE_SELF_CALL_SIMULATOR=1 and the saved recording belongs to a
 * simulator-flagged call.
 *
 * Fire-and-forget — the webhook should not await this in production.
 */
export async function runRecordingPipeline(params: {
  recordingRef: string;
  callSid: string;
  baseUrl: string;
  transferNumber?: string;
  callPurpose?: string;
  gapThresholdSec?: number;
}): Promise<ReplayStepResult[]> {
  const downloadUrl = await resolveRecordingDownloadUrl(params.recordingRef);
  const audio = await fetchAudio(downloadUrl);
  const transcript = await transcribeRecording(audio);
  const chunks = splitWordsIntoChunks(transcript.words, params.gapThresholdSec);
  console.log(
    `[SIM-RECORDING] Transcribed ${transcript.duration.toFixed(1)}s, ` +
      `${transcript.words.length} words split into ${chunks.length} chunks`
  );
  try {
    return await replayChunksThroughStateMachine({
      callSid: params.callSid,
      chunks,
      baseUrl: params.baseUrl,
      transferNumber: params.transferNumber,
      callPurpose: params.callPurpose,
    });
  } catch (err) {
    console.error(
      `[SIM-RECORDING] Replay failed for ${params.callSid}: ${toError(err).message}`
    );
    throw err;
  }
}
