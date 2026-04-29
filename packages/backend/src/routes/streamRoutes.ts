/**
 * Stream Routes — Telnyx Media Streaming WebSocket Handler
 * Receives raw audio from Telnyx, transcribes with Deepgram nova-2-phonecall,
 * and calls processSpeech() on utterance completion.
 *
 * Uses raw WebSocket to Deepgram (Deepgram v5 SDK connect() is broken for Node).
 *
 * ⚠️ LATENCY-SENSITIVE FILE — Before changing endpointing, semantic detection,
 * or dispatch timing, read ../../LATENCY-OPTIMIZATIONS.md in the repo root.
 * That doc tracks every attempted optimization so we don't repeat work.
 */

import type { IncomingMessage } from 'http';
import type WebSocket from 'ws';
import { WebSocketServer, WebSocket as WS } from 'ws';
import type { Server } from 'http';
import callStateManager from '../services/callStateManager';
import { processSpeech } from '../services/speechProcessingService';
import { shouldBargeIn } from '../services/bargeInService';
import telnyxService from '../services/telnyxService';
import {
  isActiveSimulatorCall,
  handleSimulatorTranscript,
  anySimulatorCallActive,
} from '../services/simulatorAgentService';
import { toError } from '../utils/errorUtils';
import {
  appendInterim,
  resetWatcherFields,
  shouldForceReprocess,
} from '../services/postDTMFLoopWatcher';
import {
  createHoldAudioMonitor,
  HoldAudioMonitor,
  WakeReason,
} from '../services/holdAudioMonitor';

// Per-call hold-mode audio monitors. Keyed by callControlId. Created on entry
// to LOW_POWER, destroyed on exit or stream stop.
const holdAudioMonitors = new Map<string, HoldAudioMonitor>();
// How many ~20ms PCMU frames to keep in the resume ring buffer (~3s of audio).
const RESUME_BUFFER_FRAME_CAP = 150;

// Endpointing dropped from 1800 → 500ms to shrink the "user stopped → Deepgram
// declares speech_final" window. Combined with a semantic completeness check
// (isIncompleteUtterance) + a 1000ms post-suppression safety dispatch, we keep
// mid-sentence protection without eating ~1300ms per turn.
//
// utterance_end_ms stays at 1800 as a safety net — if speech_final repeatedly
// gets suppressed and the safety timer also misses, UtteranceEnd will still
// flush the pending transcript ~1800ms after the last final word.
const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-2-phonecall' +
  '&encoding=mulaw' +
  '&sample_rate=8000' +
  '&channels=1' +
  '&language=en-US' +
  '&smart_format=true' +
  '&endpointing=500' +
  '&utterance_end_ms=1800' +
  '&interim_results=true' +
  '&vad_events=true';

// Max time to wait for more speech after we suppress a speech_final as
// semantically incomplete. If no additional fragments arrive within this
// window, we force-dispatch the buffered transcript anyway so the user doesn't
// sit in silence waiting for a turn that's already done.
const SEMANTIC_WAIT_MAX_MS = 1000;

interface DeepgramResult {
  type: 'Results';
  is_final: boolean;
  speech_final: boolean;
  start: number;
  duration: number;
  channel: { alternatives: Array<{ transcript: string }> };
}

interface DeepgramUtteranceEnd {
  type: 'UtteranceEnd';
  last_word_end: number;
}

interface DeepgramSpeechStarted {
  type: 'SpeechStarted';
  timestamp: number;
}

// Filler / hedge words — if the transcript trails off on one of these, the
// user is almost certainly still thinking and hasn't handed the turn over.
const FILLER_TRAILING_WORDS = new Set([
  'um',
  'uh',
  'umm',
  'uhh',
  'hmm',
  'like',
  'well',
  'so',
  'and',
  'or',
  'but',
  'because',
  'cause',
]);

// Dangling connectives / preps / determiners. These almost always expect a
// following noun phrase — chopping here cuts the user off mid-clause.
const CONNECTIVE_TRAILING_WORDS = new Set([
  'press',
  'to',
  'for',
  'with',
  'of',
  'in',
  'on',
  'at',
  'by',
  'select',
  'enter',
  'say',
  'dial',
  'the',
  'a',
  'an',
  'you',
  'know',
]);

/**
 * Decide whether a transcript looks like a complete thought the user intends
 * to hand over. Conservative — a false "incomplete" only delays dispatch by
 * up to SEMANTIC_WAIT_MAX_MS, but a false "complete" cuts the user off.
 */
function isIncompleteUtterance(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return true;
  const lastWord = words[words.length - 1]
    .toLowerCase()
    .replace(/[^a-z']/g, '');
  const endsWithTerminal = /[.!?]$/.test(trimmed);

  // Trailing filler — always treat as incomplete, even with punctuation (the
  // smart_format comma/period can appear after "um").
  if (FILLER_TRAILING_WORDS.has(lastWord)) return true;

  if (!endsWithTerminal) {
    // Connectives / determiners that clearly demand more content.
    if (CONNECTIVE_TRAILING_WORDS.has(lastWord)) return true;
    // Dangling numeric — e.g. "my account number is 3" (Deepgram chopped too
    // early on a digit sequence).
    if (/^\d+$/.test(lastWord)) return true;
  }

  return false;
}

const SILENT_HOLD_TIMEOUT_MS = 30_000; // Assume hold after 30s of no speech

// Registry of silent-hold timer reset functions per callSid.
// Populated by streamRoutes when a stream starts, consumed by speechProcessingService
// so that AI speech output also resets the timer (not just IVR speech).
const silentHoldResetters = new Map<string, () => void>();
const silentHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function resetSilentHoldTimer(callSid: string): void {
  const reset = silentHoldResetters.get(callSid);
  if (reset) reset();
}

/**
 * Stop and remove the silent-hold timer for this call.
 * Call this on transfer, hang_up, or any terminal state to prevent late
 * `hold` events being written after the call is done.
 */
export function stopSilentHoldTimer(callSid: string): void {
  const timer = silentHoldTimers.get(callSid);
  if (timer) clearTimeout(timer);
  silentHoldTimers.delete(callSid);
  silentHoldResetters.delete(callSid);
}

interface StreamState {
  callControlId: string;
  dgWs: WS | null;
  audioBuffer: Buffer[];
  transcript: string;
  speechFired: boolean;
  lastUtteranceAt: number;
  silentHoldTimer: ReturnType<typeof setTimeout> | null;
  // Reconnect/telemetry state
  dgReconnects: number;
  dgSilentMs: number;
  dgDisconnectedAt: number | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectGiveUp: boolean;
  expectedClose: boolean;
  onUtterance: ((text: string) => Promise<void>) | null;
  // Semantic-wait safety timer. Armed when speech_final fires on a
  // transcript flagged as incomplete; fires after SEMANTIC_WAIT_MAX_MS
  // to force-dispatch whatever's accumulated so far.
  semanticWaitTimer: ReturnType<typeof setTimeout> | null;
  // Diagnostic: which Telnyx media `track` labels we've seen for this
  // call, so the first frame on each unique track logs once. Helps
  // diagnose self-call audio-routing weirdness without flooding logs.
  tracksSeen?: Set<string>;
}

// Reconnect configuration — exponential backoff with max 3 attempts.
// Delays chosen to balance recovery speed vs Deepgram's likely transient outage window.
const RECONNECT_BACKOFF_MS = [250, 750, 2000] as const;
const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length;
// Codes that should trigger reconnection. Anything other than a clean 1000
// (Normal Closure) or 1005 (No Status) from our own explicit .close() should
// be treated as an abnormal disconnect while the call is still active.
function isAbnormalCloseCode(code: number): boolean {
  return code !== 1000;
}

// Registry of active stream states by callSid — used by the debug endpoint
// to force-close the Deepgram WS and simulate a 1006 disconnect.
const activeStreamStates = new Map<string, StreamState>();

// Test-only handle on the active-stream registry. Lets unit tests seed a
// fake stream so they can exercise injectSyntheticTranscript /
// findAiLegForSimulator without spinning up the Telnyx WS path. Do NOT
// use this from production code.
export const __testing__ = { activeStreamStates };

/**
 * Force-close the Deepgram WS for this callSid with a simulated abnormal close.
 * Returns true if a matching stream was found.
 *
 * Exposed for the /debug/kill-deepgram-ws/:callSid endpoint (non-production only).
 */
export function killDeepgramWsForCall(callSid: string): boolean {
  const state = activeStreamStates.get(callSid);
  if (!state?.dgWs) return false;
  // terminate() emits 'close' with code 1006 (Abnormal Closure)
  state.dgWs.terminate();
  return true;
}

/**
 * Inject a synthetic transcript onto a tracked stream's pipeline as if
 * Deepgram had emitted an `is_final` for `text`. Routes through the same
 * `onUtterance` callback that real Deepgram finals use, so downstream
 * (processSpeech for AI legs, simulator keyword detector for sim legs)
 * is unchanged.
 *
 * Used by the self-call simulator to bypass Deepgram on the simulator-leg
 * → AI-caller-leg direction. The simulator knows exactly what text it
 * spoke (it passed it to TTS itself), so there is no transcription
 * ambiguity — and same-app self-calls have a Telnyx audio-routing quirk
 * where Deepgram on the AI leg intermittently fails to transcribe the
 * simulator's confirmation. Synthetic injection sidesteps the issue
 * entirely for that one cross-leg signal.
 *
 * Returns true if a matching stream was found and `onUtterance` fired.
 * Callers that depend on the injection landing should check the return
 * value rather than assuming success.
 */
export function injectSyntheticTranscript(
  callSid: string,
  text: string
): boolean {
  const state = activeStreamStates.get(callSid);
  if (!state || !state.onUtterance) return false;
  console.log(
    `[STREAM-STT][SYNTHETIC] "${text.slice(0, 80)}" → ${callSid.slice(-20)}`
  );
  // Persist the synthetic line as a `conversation/user` event so the
  // visualizer/transcript reflects what the AI was fed. Without this,
  // self-call recordings show only the AI's confirmation question with
  // no visible "user" reply between it and the transfer event — the AI
  // did process the text via onUtterance, but MongoDB never recorded
  // that turn. Mirrors the real-final path in speechProcessingService
  // (which calls addConversation with type='user'). Fire-and-forget;
  // any DB error is logged but doesn't block the synthetic dispatch.
  void import('../services/callHistoryService')
    .then(m => m.default.addConversation(callSid, 'user', text))
    .catch(err =>
      console.error(
        '[STREAM-STT][SYNTHETIC] Error writing conversation/user event:',
        toError(err).message
      )
    );
  // Treat as a fresh utterance: clear any in-flight transcript buffer and
  // mark speechFired so a real DG speech_final arriving moments later
  // doesn't double-fire the same content.
  state.transcript = '';
  state.speechFired = true;
  void state.onUtterance(text);
  // Match the real-final path: clear speechFired after a short delay so
  // subsequent utterances aren't deafened.
  setTimeout(() => {
    if (state) state.speechFired = false;
  }, 2000);
  return true;
}

/**
 * Find the call_control_id of the AI-caller leg in a self-call simulator
 * pair. Same-app self-calls run two streams concurrently — the simulator
 * leg (whose id `excludeSimulatorId` is) and the AI-caller leg. Returns
 * the id of the OTHER active stream, or null if not found / ambiguous.
 *
 * Used by the simulator service to know where to route synthetic
 * transcripts.
 */
export function findAiLegForSimulator(
  excludeSimulatorId: string
): string | null {
  const others: string[] = [];
  for (const id of activeStreamStates.keys()) {
    if (id !== excludeSimulatorId) others.push(id);
  }
  // Exactly one other active stream is the well-formed case. In the
  // pathological "0 or >1 other streams" case we return null and let the
  // caller treat it as a hard skip rather than guessing.
  if (others.length !== 1) return null;
  return others[0];
}

/**
 * Returns true if a real Deepgram utterance has landed on this stream
 * since `sinceMs`. Used by the simulator's synthetic-injection fallback
 * to decide whether real audio already delivered for this turn — if it
 * did, skip the synthetic injection so the test exercises the real
 * audio path. `lastUtteranceAt` is stamped in the Deepgram-final
 * handler in `openDeepgram` (above), unconditionally on every utterance.
 */
export function hasRealUtteranceSince(
  callSid: string,
  sinceMs: number
): boolean {
  const state = activeStreamStates.get(callSid);
  if (!state) return false;
  return state.lastUtteranceAt > sinceMs;
}

/**
 * Read the reconnect telemetry for this callSid.
 * Returns null if no stream is currently tracked for this call.
 */
export function getReconnectTelemetry(
  callSid: string
): { dg_reconnects: number; dg_silent_ms: number } | null {
  const state = activeStreamStates.get(callSid);
  if (!state) return null;
  // If we're currently disconnected, include the in-progress silent window
  const inProgress = state.dgDisconnectedAt
    ? Date.now() - state.dgDisconnectedAt
    : 0;
  return {
    dg_reconnects: state.dgReconnects,
    dg_silent_ms: state.dgSilentMs + inProgress,
  };
}

function openDeepgram(
  state: StreamState,
  onUtterance: (text: string) => Promise<void>
): void {
  state.onUtterance = onUtterance;
  const key = process.env.DEEPGRAM_API_KEY || '';
  const url = process.env.DEEPGRAM_WS_URL_OVERRIDE || DEEPGRAM_URL;
  const dgWs = new WS(url, {
    headers: { Authorization: `Token ${key}` },
  });

  dgWs.on('open', () => {
    state.dgWs = dgWs;
    // If we were mid-reconnect, close out the silent window and log recovery.
    if (state.dgDisconnectedAt) {
      const silent = Date.now() - state.dgDisconnectedAt;
      state.dgSilentMs += silent;
      state.dgDisconnectedAt = null;
      console.log(
        `[STREAM-STT] Deepgram reconnected after ${silent}ms (total dg_silent_ms=${state.dgSilentMs}, dg_reconnects=${state.dgReconnects})`
      );
      // Flush telemetry to call history so it's queryable post-call.
      flushReconnectTelemetry(state).catch(err =>
        console.error(
          '[STREAM-STT] Error flushing reconnect telemetry:',
          err instanceof Error ? err.message : String(err)
        )
      );
    }
    // A successful open resets the attempt counter — future disconnects
    // get a fresh budget of MAX_RECONNECT_ATTEMPTS.
    state.reconnectAttempts = 0;
    console.log(
      `[STREAM-STT] Deepgram open, draining ${state.audioBuffer.length} buffered frames`
    );
    for (const chunk of state.audioBuffer) dgWs.send(chunk);
    state.audioBuffer = [];
  });

  dgWs.on('message', (data: Buffer) => {
    let msg: DeepgramResult | DeepgramUtteranceEnd | DeepgramSpeechStarted;
    try {
      msg = JSON.parse(data.toString()) as
        | DeepgramResult
        | DeepgramUtteranceEnd
        | DeepgramSpeechStarted;
    } catch {
      return;
    }

    if (msg.type === 'SpeechStarted') {
      // Capture the moment Deepgram's VAD decides the user began speaking.
      // Only update if a turn isn't already being timed — otherwise mid-turn
      // filler (e.g. "uh") would reset the anchor.
      const cs = callStateManager.getCallState(state.callControlId);
      if (!cs.userSpeechStartedAt) {
        cs.userSpeechStartedAt = Date.now();
      }
      return;
    }

    if (msg.type === 'Results') {
      const r = msg as DeepgramResult;
      const text = r.channel?.alternatives?.[0]?.transcript ?? '';

      // Reset silent-hold timer on ANY transcription activity (interim OR final).
      // Interim results fire every ~300ms during speech — they prove audio is being
      // received even though the utterance isn't complete yet. Without this, a 40s
      // IVR message (Best Buy scenario) would trip the 30s silent-hold timer.
      // Gate: only reset if we've made at least one action (matches onUtterance gate).
      if (text) {
        const cs = callStateManager.getCallState(state.callControlId);
        if ((cs.actionHistory || []).length > 0) {
          const reset = silentHoldResetters.get(state.callControlId);
          if (reset) reset();
        }

        // Barge-in: user/agent is speaking while we're speaking → cancel our TTS
        // so they're not talking over a robot. shouldBargeIn enforces the
        // post-start lockout and min-word guardrails.
        if (shouldBargeIn(cs, text, Date.now())) {
          cs.bargeInFiredThisTurn = true;
          cs.isSpeaking = false;
          console.log(
            `[BARGE-IN] Canceling TTS — interim="${text.substring(0, 60)}"`
          );
          telnyxService
            .stopSpeak(state.callControlId)
            .catch(err =>
              console.error('[BARGE-IN] stopSpeak error:', toError(err).message)
            );
        }

        // Post-DTMF loop watcher: accumulate interim-transcript text while
        // the watcher is armed (post-DTMF, no speech_final yet). When the
        // watcher fires, force-dispatch the accumulator through the normal
        // speech-processing entry point so the AI gets a 2nd turn even
        // against continuous-speech IVRs like Costco.
        if (!r.is_final && cs.lastDTMFPressedAt !== undefined) {
          const merged = appendInterim(cs.accumulatedInterimText ?? '', text);
          callStateManager.updateCallState(state.callControlId, {
            accumulatedInterimText: merged,
          });
          const now = Date.now();
          const fresh = callStateManager.getCallState(state.callControlId);
          if (shouldForceReprocess(fresh, now)) {
            const sinceDTMF = now - (fresh.lastDTMFPressedAt ?? now);
            const textToProcess = fresh.accumulatedInterimText ?? '';
            console.log(
              `🔁 Post-DTMF loop watcher: forcing reprocess after ${sinceDTMF}ms with accumulated "${textToProcess.slice(0, 80)}…"`
            );
            callStateManager.updateCallState(state.callControlId, {
              forcedReprocessFiredAt: now,
              accumulatedInterimText: '',
            });
            if (state.onUtterance) {
              void state.onUtterance(textToProcess);
            }
          }
        }
      }

      if (r.is_final && text) {
        console.log(
          `[DG] is_final: "${text.substring(0, 80)}" start=${r.start.toFixed(2)}s dur=${r.duration.toFixed(2)}s speech_final=${r.speech_final}`
        );
        state.transcript += (state.transcript ? ' ' : '') + text;

        // Any new is_final fragment arrived → user kept talking, so a
        // previously-armed safety timer should start over with fresh text.
        if (state.semanticWaitTimer) {
          clearTimeout(state.semanticWaitTimer);
          state.semanticWaitTimer = null;
        }

        // Fire on speech_final (faster than waiting for UtteranceEnd)
        if (r.speech_final) {
          const fullText = state.transcript.trim();
          if (isIncompleteUtterance(fullText)) {
            console.log(
              `[DG] speech_final suppressed (incomplete): "${fullText.substring(0, 80)}"`
            );
            // Arm a safety timer so we don't sit forever if Deepgram never
            // fires another speech_final / UtteranceEnd (e.g. user went silent
            // mid-sentence but their last word was a connective).
            state.semanticWaitTimer = setTimeout(() => {
              if (!state) return;
              const pending = state.transcript.trim();
              state.semanticWaitTimer = null;
              if (!pending || state.speechFired) return;
              state.transcript = '';
              state.speechFired = true;
              console.log(
                `[DG] semantic wait expired (${SEMANTIC_WAIT_MAX_MS}ms) → force-firing: "${pending.substring(0, 80)}"`
              );
              callStateManager.updateCallState(
                state.callControlId,
                resetWatcherFields()
              );
              void onUtterance(pending);
              setTimeout(() => {
                if (state) state.speechFired = false;
              }, 2000);
            }, SEMANTIC_WAIT_MAX_MS);
            return;
          }
          state.transcript = '';
          state.speechFired = true;
          console.log(
            `[DG] speech_final → firing: "${fullText.substring(0, 80)}"`
          );
          // Real speech_final — clear post-DTMF watcher fields so the next
          // press starts a fresh window.
          callStateManager.updateCallState(
            state.callControlId,
            resetWatcherFields()
          );
          if (fullText) void onUtterance(fullText);
          // Reset speechFired after a short delay so we don't permanently deafen
          // if UtteranceEnd never arrives
          setTimeout(() => {
            if (state) state.speechFired = false;
          }, 2000);
        }
      }
    } else if (msg.type === 'UtteranceEnd') {
      if (state.semanticWaitTimer) {
        clearTimeout(state.semanticWaitTimer);
        state.semanticWaitTimer = null;
      }
      const text = state.transcript.trim();
      console.log(
        `[DG] UtteranceEnd last_word=${msg.last_word_end?.toFixed(2)}s transcript="${text.substring(0, 80)}" speechFired=${state.speechFired}`
      );
      // Only fire if speech_final didn't already handle this utterance
      if (text && !state.speechFired) {
        state.transcript = '';
        callStateManager.updateCallState(
          state.callControlId,
          resetWatcherFields()
        );
        void onUtterance(text);
      } else {
        state.transcript = '';
      }
      state.speechFired = false;
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
    // Clear pointer so media frames start buffering instead of blindly sending.
    if (state.dgWs === dgWs) state.dgWs = null;

    // Expected shutdown (stop event / ws close) — no reconnect needed.
    if (state.expectedClose) return;
    // Clean 1000 closure is also considered intentional.
    if (!isAbnormalCloseCode(code)) return;
    if (state.reconnectGiveUp) return;

    scheduleReconnect(state, code);
  });
}

/**
 * Schedule a reconnect attempt with exponential backoff.
 * Gives up after MAX_RECONNECT_ATTEMPTS and leaves the STT dead for the call.
 */
function scheduleReconnect(state: StreamState, reasonCode: number): void {
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    state.reconnectGiveUp = true;
    console.error(
      `[STREAM-STT] Deepgram reconnect FAILED after ${MAX_RECONNECT_ATTEMPTS} attempts — STT is dead for call ${state.callControlId.slice(-20)} (last reason: code ${reasonCode})`
    );
    // Still flush whatever telemetry we have.
    flushReconnectTelemetry(state).catch(() => {});
    return;
  }

  // Start tracking silent window from the first disconnect, not subsequent retries.
  if (!state.dgDisconnectedAt) {
    state.dgDisconnectedAt = Date.now();
  }

  const attempt = state.reconnectAttempts + 1;
  const delay = RECONNECT_BACKOFF_MS[state.reconnectAttempts];
  state.reconnectAttempts = attempt;
  state.dgReconnects += 1;

  console.log(
    `[STREAM-STT] Reconnect attempt ${attempt} (after ${delay}ms) — reason: code ${reasonCode}`
  );

  const timer = setTimeout(() => {
    state.reconnectTimer = null;
    // If the call ended while we were waiting, bail.
    if (state.expectedClose) return;
    if (!state.onUtterance) return;
    openDeepgram(state, state.onUtterance);
  }, delay);
  state.reconnectTimer = timer;
}

/**
 * Write reconnect telemetry into the call state manager so it's readable
 * for the rest of the call and queryable afterwards via getReconnectTelemetry().
 * Intentionally writes as untyped fields — the CallState interface doesn't
 * declare dg_reconnects/dg_silent_ms but Object.assign copies them through.
 */
async function flushReconnectTelemetry(state: StreamState): Promise<void> {
  const cs = callStateManager.getCallState(state.callControlId) as unknown as {
    dg_reconnects?: number;
    dg_silent_ms?: number;
  };
  cs.dg_reconnects = state.dgReconnects;
  cs.dg_silent_ms = state.dgSilentMs;
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
          speechFired: false,
          lastUtteranceAt: Date.now(),
          silentHoldTimer: null,
          dgReconnects: 0,
          dgSilentMs: 0,
          dgDisconnectedAt: null,
          reconnectAttempts: 0,
          reconnectTimer: null,
          reconnectGiveUp: false,
          expectedClose: false,
          onUtterance: null,
          semanticWaitTimer: null,
        };
        activeStreamStates.set(callControlId, state);

        const resetSilentHoldTimer = () => {
          if (state?.silentHoldTimer) clearTimeout(state.silentHoldTimer);
          if (!state) return;
          state.lastUtteranceAt = Date.now();
          const timer = setTimeout(() => {
            if (!state) return;
            // Don't write a hold event if the timer's been stopped via stopSilentHoldTimer
            // (transfer, hang_up) — silentHoldTimers won't contain this timer anymore.
            if (silentHoldTimers.get(callControlId) !== timer) return;
            console.log(
              `⏳ Silent hold detected (${SILENT_HOLD_TIMEOUT_MS / 1000}s no speech)`
            );
            import('../services/callHistoryService').then(m =>
              m.default
                .addHoldDetected(state!.callControlId)
                .catch(err =>
                  console.error('[STREAM] Error writing hold event:', err)
                )
            );
          }, SILENT_HOLD_TIMEOUT_MS);
          state.silentHoldTimer = timer;
          silentHoldTimers.set(callControlId, timer);
        };
        silentHoldResetters.set(callControlId, resetSilentHoldTimer);

        openDeepgram(state, async text => {
          // Simulator inbound legs reuse the generic Deepgram pipeline but
          // must NOT run through processSpeech — that's the AI-caller logic
          // and would try to navigate IVR menus on our own scripted agent.
          // Route the transcript to the simulator's keyword detector instead.
          if (isActiveSimulatorCall(callControlId)) {
            console.log(
              `[STREAM-STT][SIM] "${text.slice(0, 80)}" (${callControlId.slice(-20)})`
            );
            handleSimulatorTranscript(callControlId, text);
            return;
          }

          // Stamp the real-utterance time unconditionally on every Deepgram
          // speech_final, regardless of action-history. The
          // synthetic-injection fallback path in simulatorAgentService reads
          // this to decide whether real Deepgram already delivered for this
          // turn — without this stamp, the very first greeting (when
          // actionHistory is empty) wouldn't register.
          if (state) state.lastUtteranceAt = Date.now();
          // Silent-hold timer only starts AFTER we've made at least one action —
          // before that, silence is just initial IVR greeting/intro gaps (Target scenario).
          const cs = callStateManager.getCallState(callControlId);
          if ((cs.actionHistory || []).length > 0) {
            resetSilentHoldTimer();
          }
          const callState = callStateManager.getCallState(callControlId);
          if (callState.isSpeaking) return;

          const sttDoneAt = Date.now();
          // Stamp the moment Deepgram declared the user finished speaking.
          // This is the anchor for the perceived-latency measurement.
          callState.userSpeechEndedAt = sttDoneAt;
          callState.turnTimingEmittedForCurrentTurn = false;
          console.log(`[STREAM-STT] "${text}"`);
          try {
            await processSpeech({
              _sttDoneAt: sttDoneAt,
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
        // Only forward INBOUND-track frames to Deepgram. both_tracks on
        // Telnyx sends BOTH inbound + outbound as separate messages with
        // track labels. If we forwarded both, Deepgram sees an interleaved
        // stream (sim voice + our own AI TTS every 20ms) that decodes to
        // empty text after the first utterance — that's exactly what
        // diagnostic runs showed: first utterance transcribed cleanly,
        // then outbound frames started arriving and subsequent results
        // went empty. Inbound-only = clean remote-party audio.
        //
        // EXCEPTION for active simulator calls: same-app self-calls have
        // a Telnyx audio-routing quirk where the AI-caller leg's
        // "inbound" track delivers audio that Deepgram cannot lock onto
        // (constant mu-law silence frames in between speech, no
        // speech_final fires). Forwarding both tracks for the AI leg of
        // a self-call gives DG a continuous-audio reference that
        // restores speech_final detection. The simulator's own TTS
        // (which would otherwise pollute the stream as outbound on the
        // AI leg) is silent on the AI leg's outbound track because the
        // AI hasn't spoken yet, so the interleaving concern doesn't
        // apply during the greeting phase.
        // True when ANY simulator call is active anywhere in the process —
        // a coarse signal that this stream is part of a self-call pair.
        const isSimulatorPair = anySimulatorCallActive();
        const isInbound = track === 'inbound' || track === 'inbound_track';
        const shouldForward = isInbound || isSimulatorPair;
        // Debug counter: log first frame seen per track per call so we can
        // diagnose self-call audio-routing problems where the remote party's
        // voice arrives on an unexpected track.
        if (!state.tracksSeen) state.tracksSeen = new Set();
        if (!state.tracksSeen.has(track)) {
          state.tracksSeen.add(track);
          console.log(
            `[STREAM] First media frame seen on track="${track}" for ${state.callControlId.slice(-20)} (forwarding=${shouldForward}, simPair=${isSimulatorPair})`
          );
        }
        if (!shouldForward) return;
        const payload = (mediaData?.payload as string) || '';
        if (!payload) return;

        const pcmuBytes = Buffer.from(payload, 'base64');

        // Hold low-power mode: while active, do NOT forward inbound audio
        // to Deepgram. Run the local audio monitor instead and resume on
        // wake triggers (silence-break, speech-onset, periodic-probe).
        const callControlIdForHold = state.callControlId;
        const callStateForHold =
          callStateManager.getCallState(callControlIdForHold);
        if (callStateForHold.holdLowPowerActive) {
          // Lazily create the monitor on first frame after entry.
          let monitor = holdAudioMonitors.get(callControlIdForHold);
          if (!monitor) {
            monitor = createHoldAudioMonitor(
              callStateForHold.holdLowPowerEnteredAt ?? Date.now()
            );
            holdAudioMonitors.set(callControlIdForHold, monitor);
          }

          // Maintain a small ring buffer of the most-recent frames so that
          // when we wake we can re-feed ~3s of audio to Deepgram and the
          // first agent words aren't clipped.
          const ringBuf = callStateForHold.holdAudioRingBuffer ?? [];
          ringBuf.push(pcmuBytes);
          if (ringBuf.length > RESUME_BUFFER_FRAME_CAP) ringBuf.shift();
          callStateForHold.holdAudioRingBuffer = ringBuf;

          const wake: WakeReason | null = monitor.pushFrame(
            pcmuBytes,
            Date.now()
          );
          if (wake) {
            console.log(
              `📡 Hold low-power exit (${wake}) for ${callControlIdForHold.slice(-20)} — resuming Deepgram forwarding`
            );
            // Replay buffered audio to Deepgram so first words aren't clipped.
            if (state.dgWs?.readyState === WS.OPEN) {
              for (const chunk of ringBuf) state.dgWs.send(chunk);
            } else {
              for (const chunk of ringBuf) state.audioBuffer.push(chunk);
            }
            // Clear hold low-power state and the monitor.
            callStateManager.updateCallState(callControlIdForHold, {
              holdLowPowerActive: false,
              holdLowPowerEnteredAt: undefined,
              holdAudioRingBuffer: undefined,
            });
            holdAudioMonitors.delete(callControlIdForHold);
          }
          // Whether we woke or not, do NOT forward this frame to Deepgram —
          // it's already been buffered (or replayed) above.
          return;
        }

        if (state.dgWs?.readyState === WS.OPEN) {
          state.dgWs.send(pcmuBytes);
        } else {
          state.audioBuffer.push(pcmuBytes);
        }
      } else if (event === 'stop' && state) {
        // Flush any accumulated transcript that Deepgram hasn't sent UtteranceEnd for
        const remaining = state.transcript.trim();
        if (remaining) {
          console.log(`[STREAM-STT] Flushing on stop: "${remaining}"`);
          const callControlId = state.callControlId;
          // Simulator legs: route the flushed transcript to the keyword
          // detector, never through processSpeech.
          if (isActiveSimulatorCall(callControlId)) {
            handleSimulatorTranscript(callControlId, remaining);
          } else {
            const callState = callStateManager.getCallState(callControlId);
            if (!callState.isSpeaking) {
              processSpeech({
                callSid: callControlId,
                speechResult: remaining,
                isFirstCall: false,
                baseUrl: '',
                transferNumber: callState.transferConfig?.transferNumber,
                callPurpose: callState.transferConfig?.callPurpose,
                customInstructions: callState.customInstructions,
                userPhone: callState.userPhone,
                skipInfoRequests: callState.skipInfoRequests,
              }).catch(err =>
                console.error(
                  '[STREAM-STT] flush processSpeech error:',
                  toError(err).message
                )
              );
            }
          }
        }
        if (state.silentHoldTimer) clearTimeout(state.silentHoldTimer);
        if (state.semanticWaitTimer) clearTimeout(state.semanticWaitTimer);
        silentHoldResetters.delete(state.callControlId);
        silentHoldTimers.delete(state.callControlId);
        holdAudioMonitors.delete(state.callControlId);
        state.expectedClose = true;
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        if (state.dgWs?.readyState === WS.OPEN) {
          state.dgWs.close();
        }
        // Final telemetry flush on clean stop.
        void flushReconnectTelemetry(state);
        activeStreamStates.delete(state.callControlId);
        console.log(`[STREAM] Stopped for ${state.callControlId.slice(-20)}`);
        state = null;
      }
    });

    ws.on('error', err => {
      console.error('[STREAM] WebSocket error:', err.message);
    });

    ws.on('close', () => {
      if (state?.callControlId) {
        // Unconditional cleanup (fixes memory leak on abnormal disconnect where dgWs may already be closed)
        silentHoldResetters.delete(state.callControlId);
        silentHoldTimers.delete(state.callControlId);
        holdAudioMonitors.delete(state.callControlId);
        if (state.silentHoldTimer) clearTimeout(state.silentHoldTimer);
        if (state.semanticWaitTimer) clearTimeout(state.semanticWaitTimer);
        state.expectedClose = true;
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        void flushReconnectTelemetry(state);
        activeStreamStates.delete(state.callControlId);
      }
      if (state?.dgWs?.readyState === WS.OPEN) {
        state.dgWs.close();
      }
      state = null;
    });
  });

  console.log('  ✅ /voice/stream WebSocket server attached');
}
