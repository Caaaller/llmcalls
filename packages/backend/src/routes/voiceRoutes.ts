/**
 * Voice Routes — Telnyx Call Control
 * Handles all Telnyx webhook events for outbound IVR navigation
 */

import express, { Request, Response } from 'express';
import {
  TelnyxWebhookBody,
  TelnyxWebhookPayload,
  decodeClientState,
  decodeBridgeSourceFromClientState,
} from '../types/telnyx';
import callStateManager from '../services/callStateManager';
import callHistoryService from '../services/callHistoryService';
import { EndReason } from '../models/CallHistory';
import telnyxService from '../services/telnyxService';
import { runSimulatorFlow } from '../services/simulatorAgentService';
import transferConfig from '../config/transfer-config';
import { TransferConfig as TransferConfigType } from '../config/transfer-config';
import { logOnError } from '../utils/logOnError';

const router: express.Router = express.Router();

const STALL_POLL_INTERVAL_MS = 100;
const STALL_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Check if a `call.initiated` event belongs to our self-call simulator DID.
 * Returns false (skip) if `TELNYX_SIMULATOR_NUMBER` is unset so we never
 * accidentally activate the simulator in a prod-like env.
 *
 * Single-app topology (Workaround A for Issue #D): both the outbound caller
 * leg and the inbound simulator leg ride the SAME Call Control App. We
 * discriminate by `direction` + `to` — only the inbound simulator leg has
 * `direction === 'incoming'` AND `to === simNumber`. The outbound leg has
 * `direction === 'outgoing'`, so it never matches here.
 */
function isSimulatorInboundCall(
  payload: TelnyxWebhookPayload | undefined
): boolean {
  const simNumber = process.env.TELNYX_SIMULATOR_NUMBER;
  if (!simNumber) return false;
  if (!payload) return false;
  if (payload.to !== simNumber) return false;
  return payload.direction === 'incoming';
}

function getTelnyxVoice(config: TransferConfigType): string {
  const configVoice = config.aiSettings.voice;
  if (configVoice?.startsWith('Polly.')) {
    return `AWS.${configVoice}-Neural`;
  }
  return configVoice || 'Telnyx.KokoroTTS.am_michael';
}

/**
 * Start a server-side stall timer.
 * Polls callStateManager every STALL_POLL_INTERVAL_MS until the user provides
 * the requested info or 2 minutes elapses, then fires the Telnyx speak action.
 */
export function startStallTimer(callControlId: string): void {
  const callState = callStateManager.getCallState(callControlId);
  if (callState.stallTimer) {
    clearInterval(callState.stallTimer);
  }

  const stallStartTime = Date.now();

  const timer = setInterval(() => {
    void (async () => {
      const state = callStateManager.getCallState(callControlId);
      const pending = state.pendingInfoRequest;

      if (!pending) {
        clearInterval(timer);
        callStateManager.updateCallState(callControlId, {
          stallTimer: undefined,
        });
        return;
      }

      const elapsed = Date.now() - stallStartTime;

      // User provided a response
      if (pending.userResponse) {
        clearInterval(timer);
        callStateManager.updateCallState(callControlId, {
          stallTimer: undefined,
        });

        console.log(
          `✅ Info received (${pending.respondedVia}): ${pending.userResponse}`
        );

        callHistoryService
          .addInfoResponse(
            callControlId,
            pending.userResponse,
            pending.respondedVia || 'web'
          )
          .catch(err => console.error('Error logging info response:', err));

        const config = transferConfig.createConfig({
          transferNumber:
            state.transferConfig?.transferNumber ||
            process.env.TRANSFER_PHONE_NUMBER,
          callPurpose: state.transferConfig?.callPurpose,
          customInstructions: state.customInstructions,
        });

        const dataEntryMode = pending.dataEntryMode || 'speech';
        const digits = pending.userResponse.replace(/\D/g, '');

        state.pendingInfoRequest = undefined;

        if (dataEntryMode === 'dtmf' && digits.length > 0) {
          await telnyxService.sendDTMF(callControlId, `ww${digits}`);
        } else {
          await telnyxService.speakText(
            callControlId,
            pending.userResponse,
            getTelnyxVoice(config)
          );
        }
        return;
      }

      // Timeout
      if (elapsed >= STALL_TIMEOUT_MS) {
        clearInterval(timer);
        callStateManager.updateCallState(callControlId, {
          stallTimer: undefined,
        });

        console.log('⏰ Stall timeout — giving up on info request');
        state.pendingInfoRequest = undefined;

        const config = transferConfig.createConfig({
          transferNumber:
            state.transferConfig?.transferNumber ||
            process.env.TRANSFER_PHONE_NUMBER,
          callPurpose: state.transferConfig?.callPurpose,
          customInstructions: state.customInstructions,
        });

        await telnyxService.speakText(
          callControlId,
          "I don't have that information. Can I speak with a representative?",
          getTelnyxVoice(config)
        );
      }
    })();
  }, STALL_POLL_INTERVAL_MS);

  callStateManager.updateCallState(callControlId, { stallTimer: timer });
}

/**
 * Handle call.answered event
 */
async function handleCallAnswered(
  callControlId: string,
  payload: TelnyxWebhookPayload | undefined
): Promise<void> {
  // Skip the entire AI caller pipeline for inbound simulator legs. They
  // are driven by the simulator service directly — starting Deepgram +
  // the AI caller handler on them would (a) compete for Deepgram sockets
  // with the real outbound leg and (b) transcribe our own TTS.
  //
  // Single-app topology: discriminator is `direction === 'incoming'` AND
  // `to === TELNYX_SIMULATOR_NUMBER`. The outbound caller leg has
  // `direction === 'outgoing'` so it falls through to the normal
  // pipeline. (Pre-Workaround-A this was keyed on connection_id, but
  // both legs now share the `llmcalls` connection.)
  const simNumber = process.env.TELNYX_SIMULATOR_NUMBER;
  if (
    simNumber &&
    payload?.direction === 'incoming' &&
    payload?.to === simNumber
  ) {
    console.log(
      `[SIM] call.answered on simulator inbound leg ${callControlId.slice(-20)} — skipping AI caller pipeline`
    );
    return;
  }

  // Bridge-transfer target leg: when we dialed the user (via dialForBridge)
  // as part of a human-detected transfer, that new leg carries a
  // bridgeSourceCallControlId in client_state. On answer, bridge the two
  // legs so audio flows directly A↔C and our AI drops out of the media.
  const bridgeSource = decodeBridgeSourceFromClientState(payload?.client_state);
  if (bridgeSource) {
    console.log(
      `🔗 call.answered on bridge-target ${callControlId.slice(-20)} — bridging to ${bridgeSource.slice(-20)}`
    );
    try {
      await telnyxService.bridgeCalls(bridgeSource, callControlId);
      logOnError(
        callHistoryService.updateTransferStatus(bridgeSource, true),
        'Error marking transfer success on bridge'
      );
    } catch (err) {
      console.error('Bridge action failed:', err);
    }
    return;
  }

  const clientConfig = decodeClientState(payload?.client_state);

  const config = transferConfig.createConfig({
    transferNumber:
      clientConfig?.transferNumber || process.env.TRANSFER_PHONE_NUMBER,
    userPhone: clientConfig?.userPhone || process.env.USER_PHONE_NUMBER,
    userEmail: clientConfig?.userEmail || process.env.USER_EMAIL,
    callPurpose:
      clientConfig?.callPurpose ||
      process.env.CALL_PURPOSE ||
      'speak with a representative',
    customInstructions: clientConfig?.customInstructions || '',
  });

  callStateManager.updateCallState(callControlId, {
    transferConfig: config as TransferConfigType,
    previousMenus: [],
    customInstructions: config.customInstructions,
    userPhone: config.userPhone,
    ...(clientConfig?.skipInfoRequests && { skipInfoRequests: true }),
    ...(clientConfig?.requireLiveAgent && { requireLiveAgent: true }),
  });

  logOnError(
    callHistoryService.startCall(callControlId, {
      to: payload?.to || '',
      from: payload?.from || '',
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose,
      customInstructions: config.customInstructions,
    }),
    'Error starting call history'
  );

  // Start audio streaming to our WebSocket for Whisper transcription
  try {
    const baseUrl =
      process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL || '';
    const wsBase = baseUrl
      .replace(/^https?:\/\//, 'wss://')
      .replace(/\/voice$/, '');
    const streamUrl = `${wsBase}/voice/stream`;
    await telnyxService.startStreaming(callControlId, streamUrl);
    console.log(
      `[STREAM] Started for ${callControlId.slice(-20)} → ${streamUrl}`
    );
  } catch (err) {
    console.error('Failed to start audio streaming:', err);
  }
}

/**
 * Compute and persist a single per-turn latency snapshot when Telnyx reports
 * that AI audio has hit the wire (`call.speak.started`). Guards against
 * duplicate emission when streaming TTS fires multiple `speak.started` events
 * per turn.
 */
function recordTurnTiming(callControlId: string): void {
  const cs = callStateManager.getCallState(callControlId);
  if (cs.turnTimingEmittedForCurrentTurn) return;
  const { userSpeechEndedAt, ttsDispatchedAt, userSpeechStartedAt } = cs;
  if (!userSpeechEndedAt || !ttsDispatchedAt) return;

  const ttsSpeakStartedAt = Date.now();
  const endDispatchMs = ttsDispatchedAt - userSpeechEndedAt;
  const dispatchSpeakMs = ttsSpeakStartedAt - ttsDispatchedAt;
  const perceivedMs = endDispatchMs + dispatchSpeakMs;
  const endpointingMs = userSpeechStartedAt
    ? userSpeechEndedAt - userSpeechStartedAt
    : undefined;

  const {
    firstTokenAt,
    speechFieldCompleteAt,
    firstSentenceDispatchedAt,
    streamCompleteAt,
    streamFallbackFired,
  } = cs;
  const speechCompleteDeltaMs =
    speechFieldCompleteAt !== undefined && firstTokenAt !== undefined
      ? speechFieldCompleteAt - firstTokenAt
      : undefined;
  const streamTailMs =
    streamCompleteAt !== undefined && speechFieldCompleteAt !== undefined
      ? streamCompleteAt - speechFieldCompleteAt
      : undefined;

  cs.turnTimingEmittedForCurrentTurn = true;
  if (!cs.turnTimings) cs.turnTimings = [];
  cs.turnTimings.push({
    speechStartedAt: userSpeechStartedAt,
    speechEndedAt: userSpeechEndedAt,
    ttsDispatchedAt,
    ttsSpeakStartedAt,
    endpointingMs,
    perceivedMs,
    firstTokenAt,
    speechFieldCompleteAt,
    firstSentenceDispatchedAt,
    streamCompleteAt,
    streamFallbackFired,
  });

  // Clear anchors so the next turn starts fresh.
  cs.userSpeechStartedAt = undefined;
  cs.userSpeechEndedAt = undefined;
  cs.ttsDispatchedAt = undefined;
  cs.firstTokenAt = undefined;
  cs.speechFieldCompleteAt = undefined;
  cs.firstSentenceDispatchedAt = undefined;
  cs.streamCompleteAt = undefined;
  cs.streamFallbackFired = undefined;

  const endpointingFragment =
    endpointingMs !== undefined ? `speechStart→end=${endpointingMs}ms  ` : '';
  const subFragment =
    firstTokenAt !== undefined
      ? `  ttft=${firstTokenAt - userSpeechEndedAt}ms` +
        (speechCompleteDeltaMs !== undefined
          ? `  speechDelta=${speechCompleteDeltaMs}ms`
          : '') +
        (firstSentenceDispatchedAt !== undefined &&
        speechFieldCompleteAt !== undefined
          ? `  dispatchAfterSpeech=${firstSentenceDispatchedAt - speechFieldCompleteAt}ms`
          : '') +
        (streamTailMs !== undefined ? `  streamTail=${streamTailMs}ms` : '') +
        (streamFallbackFired ? `  FALLBACK=true` : '')
      : '';
  console.log(
    `⏱️ TURN LATENCY  ${endpointingFragment}end→dispatch=${endDispatchMs}ms  dispatch→speakStart=${dispatchSpeakMs}ms  TOTAL_PERCEIVED=${perceivedMs}ms${subFragment}  call=${callControlId.slice(-20)}`
  );

  logOnError(
    callHistoryService.addTurnTiming(callControlId, {
      speechStartedAt: userSpeechStartedAt,
      speechEndedAt: userSpeechEndedAt,
      ttsDispatchedAt,
      ttsSpeakStartedAt,
      endpointingMs,
      perceivedMs,
      firstTokenAt,
      speechFieldCompleteAt,
      firstSentenceDispatchedAt,
      streamCompleteAt,
      streamFallbackFired,
      speechCompleteDeltaMs,
      streamTailMs,
    }),
    'Error persisting turn_timing event'
  );

  // Re-stamp the most recent AI conversation event with the true
  // ttsSpeakStartedAt — the moment Telnyx actually started playing audio.
  // The event was originally written at dispatch time (best estimate
  // available pre-webhook), which runs ~1-3s ahead of audible playback.
  logOnError(
    callHistoryService.updateLastAIConversationTimestamp(
      callControlId,
      new Date(ttsSpeakStartedAt)
    ),
    'Error updating AI conversation timestamp'
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

function logCallTimingSummary(callControlId: string): void {
  const cs = callStateManager.getCallState(callControlId);
  const turns = cs.turnTimings ?? [];
  if (turns.length === 0) return;
  const perceived = turns.map(t => t.perceivedMs).sort((a, b) => a - b);
  const endpointing = turns
    .map(t => t.endpointingMs)
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);
  const perceivedMedian = percentile(perceived, 50);
  const perceivedP90 = percentile(perceived, 90);
  const endpointingMedian =
    endpointing.length > 0 ? percentile(endpointing, 50) : undefined;
  const endpointingFragment =
    endpointingMedian !== undefined
      ? `  endpointing_median=${endpointingMedian}ms`
      : '';
  console.log(
    `⏱️ CALL SUMMARY  turns=${turns.length}  perceived_median=${perceivedMedian}ms  perceived_p90=${perceivedP90}ms${endpointingFragment}  call=${callControlId.slice(-20)}`
  );
}

const ERROR_HANGUP_CAUSES = new Set<string>([
  'call_rejected',
  'destination_out_of_order',
  'incompatible_destination',
  'network_out_of_order',
  'temporary_failure',
  'service_unavailable',
  'recovery_on_timer_expire',
  'protocol_error',
  'bearer_capability_not_available',
  'facility_not_implemented',
]);

/**
 * Derive an endReason from the Telnyx hangup payload.
 * Returns undefined if we cannot confidently classify — callers should only
 * set this when no prior endReason exists on the record.
 */
function deriveHangupEndReason(
  cause: string | undefined,
  source: string | undefined
): EndReason {
  if (cause && ERROR_HANGUP_CAUSES.has(cause)) return 'application_error';
  if (source === 'callee' && cause !== 'normal_clearing') return 'ivr_hangup';
  if (cause === 'normal_clearing') return 'other';
  return 'other';
}

/**
 * Handle call.hangup event
 */
function handleCallHangup(
  callControlId: string,
  payload: TelnyxWebhookPayload | undefined
): void {
  const cause = payload?.hangup_cause;
  const source = payload?.hangup_source;
  const internalStatus =
    cause === 'normal_clearing' || !cause ? 'completed' : 'failed';

  // Capture Deepgram reconnect telemetry from the in-memory call state before
  // clearing it — otherwise the values vanish before we can persist them.
  const state = callStateManager.getCallState(callControlId);
  const telemetry = state as unknown as {
    dg_reconnects?: number;
    dg_silent_ms?: number;
  };
  const dgReconnects = telemetry.dg_reconnects ?? 0;
  const dgSilentMs = telemetry.dg_silent_ms ?? 0;
  if (dgReconnects > 0 || dgSilentMs > 0) {
    logOnError(
      callHistoryService.setReconnectTelemetry(
        callControlId,
        dgReconnects,
        dgSilentMs
      ),
      'Error persisting Deepgram reconnect telemetry'
    );
  }

  const endReason = deriveHangupEndReason(cause, source);
  logOnError(
    callHistoryService.endCall(callControlId, internalStatus, endReason, cause),
    'Error ending call'
  );

  // Emit per-call latency summary before state gets wiped.
  logCallTimingSummary(callControlId);

  // Clean up stall timer if active
  if (state.stallTimer) {
    clearInterval(state.stallTimer);
  }

  callStateManager.clearCallState(callControlId);
}

/**
 * Handle call.recording.saved event
 */
async function handleRecordingSaved(
  callControlId: string,
  payload: TelnyxWebhookPayload | undefined
): Promise<void> {
  // Store recording_id (not the expiring S3 URL) so we can fetch fresh URLs on demand
  const recordingId =
    payload?.recording_id ||
    ((payload as Record<string, unknown>)?.id as string | undefined);
  if (recordingId) {
    console.log(
      `🎙️ Recording saved: ${recordingId} for ${callControlId.slice(-20)}`
    );
    await callHistoryService.setRecordingUrl(
      callControlId,
      `telnyx:${recordingId}`
    );
  }
}

/**
 * Main Telnyx webhook endpoint — receives all call events
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  res.status(200).send('OK'); // Acknowledge immediately

  const body = req.body as TelnyxWebhookBody;
  const event = body?.data;
  if (!event) return;

  const eventType = event.event_type || '';
  const payload = event.payload;
  const callControlId = payload?.call_control_id || '';

  if (!callControlId) return;

  try {
    switch (eventType) {
      case 'call.initiated':
        if (isSimulatorInboundCall(payload)) {
          console.log(
            `[SIM] Inbound simulator call detected on ${payload?.to} — launching scripted flow`
          );
          // Fire-and-forget — don't block the webhook response pipeline.
          void runSimulatorFlow(callControlId);
        }
        // Outbound-initiated legs also surface here; ignore them — our
        // /voice handler acts on `call.answered` for those.
        break;
      case 'call.answered':
        await handleCallAnswered(callControlId, payload);
        break;
      case 'call.hangup':
        handleCallHangup(callControlId, payload);
        break;
      case 'call.bridged': {
        // Fires when our transferred-to leg (the user's phone) answers and
        // Telnyx bridges it to the original call (the human agent leg).
        // Before this, the transfer event in MongoDB sits at success=false
        // (the initial record we write when initiating transfer). Flip it
        // to true so the UI shows "Transfer OK" instead of "Transfer failed".
        console.log(
          `🔗 call.bridged on ${callControlId.slice(-20)} — marking transfer success`
        );
        logOnError(
          callHistoryService.updateTransferStatus(callControlId, true),
          'Error updating transfer status on bridge'
        );
        break;
      }
      case 'call.recording.saved':
        await handleRecordingSaved(callControlId, payload);
        break;
      case 'call.speak.started': {
        callStateManager.updateCallState(callControlId, { isSpeaking: true });
        recordTurnTiming(callControlId);
        break;
      }
      case 'call.speak.ended': {
        // Don't clear isSpeaking mid-stream — sentence-level streaming TTS fires
        // multiple speak.ended events per turn. The final flush() will clear
        // both streamingTTSActive and isSpeaking once the chain drains.
        const speakEndState = callStateManager.getCallState(callControlId);
        if (!speakEndState.streamingTTSActive) {
          callStateManager.updateCallState(callControlId, {
            isSpeaking: false,
          });
        }
        break;
      }
      default:
        if (eventType.startsWith('call.')) {
          console.log(`[EVENT] Unhandled: ${eventType}`);
        }
    }
  } catch (err) {
    console.error(`Error handling Telnyx event ${eventType}:`, err);
  }
});

/**
 * SMS reply webhook — Telnyx POSTs here when user replies via SMS.
 * Finds the active call by phone number and resolves the pending info request.
 */
router.post('/sms-reply', (req: Request, res: Response): void => {
  // Support both Telnyx nested payload and flat format
  const from: string =
    (req.body?.data?.payload?.from?.phone_number as string) ||
    (req.body?.From as string) ||
    '';
  const text: string = (
    (req.body?.data?.payload?.text as string) ||
    (req.body?.Body as string) ||
    ''
  ).trim();

  res.status(200).send('OK');

  if (!text) return;

  const callSid = callStateManager.findCallByUserPhone(from);
  if (!callSid) return;

  const resolved = callStateManager.resolveInfoRequest(callSid, text, 'sms');
  if (resolved) {
    console.log(`📱 SMS reply from ${from}: "${text}" → call ${callSid}`);
    // The stall timer picks up the resolved state on next tick
  }
});

/**
 * Transfer status callback
 */
router.post('/transfer-status', (req: Request, res: Response): void => {
  const callControlId =
    (req.body?.data?.payload?.call_control_id as string | undefined) ||
    (req.body?.CallSid as string | undefined);
  const state =
    (req.body?.data?.payload?.state as string | undefined) ||
    (req.body?.CallStatus as string | undefined);

  if (callControlId && state) {
    if (state === 'bridged' || state === 'answered') {
      logOnError(
        callHistoryService.updateTransferStatus(callControlId, true),
        'Error updating transfer status'
      );
    } else if (state === 'hangup' || state === 'failed') {
      logOnError(
        callHistoryService.updateTransferStatus(callControlId, false),
        'Error updating transfer status'
      );
      logOnError(
        callHistoryService.endCall(
          callControlId,
          'completed',
          'transfer_completed'
        ),
        'Error ending call after transfer'
      );
    }
  }

  res.status(200).send('OK');
});

export default router;
