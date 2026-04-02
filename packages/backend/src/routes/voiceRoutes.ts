/**
 * Voice Routes — Telnyx Call Control
 * Handles all Telnyx webhook events for outbound IVR navigation
 */

import express, { Request, Response } from 'express';
import {
  TelnyxWebhookBody,
  TelnyxWebhookPayload,
  decodeClientState,
} from '../types/telnyx';
import callStateManager from '../services/callStateManager';
import callHistoryService from '../services/callHistoryService';
import telnyxService from '../services/telnyxService';
import transferConfig from '../config/transfer-config';
import { TransferConfig as TransferConfigType } from '../config/transfer-config';
import { logOnError } from '../utils/logOnError';

const router: express.Router = express.Router();

const STALL_POLL_INTERVAL_MS = 100;
const STALL_TIMEOUT_MS = 2 * 60 * 1000;

function getTelnyxVoice(config: TransferConfigType): string {
  const configVoice = config.aiSettings.voice;
  if (configVoice?.startsWith('Polly.')) {
    return `AWS.${configVoice}-Neural`;
  }
  return configVoice || 'AWS.Polly.Matthew-Neural';
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
 * Handle call.hangup event
 */
function handleCallHangup(
  callControlId: string,
  payload: TelnyxWebhookPayload | undefined
): void {
  const cause = payload?.hangup_cause;
  const internalStatus =
    cause === 'normal_clearing' || !cause ? 'completed' : 'failed';

  logOnError(
    callHistoryService.endCall(callControlId, internalStatus),
    'Error ending call'
  );

  // Clean up stall timer if active
  const state = callStateManager.getCallState(callControlId);
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
      case 'call.answered':
        await handleCallAnswered(callControlId, payload);
        break;
      case 'call.hangup':
        handleCallHangup(callControlId, payload);
        break;
      case 'call.recording.saved':
        await handleRecordingSaved(callControlId, payload);
        break;
      case 'call.speak.started':
        callStateManager.updateCallState(callControlId, { isSpeaking: true });
        break;
      case 'call.speak.ended':
        callStateManager.updateCallState(callControlId, { isSpeaking: false });
        break;
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
        callHistoryService.endCall(callControlId, 'completed'),
        'Error ending call after transfer'
      );
    }
  }

  res.status(200).send('OK');
});

export default router;
