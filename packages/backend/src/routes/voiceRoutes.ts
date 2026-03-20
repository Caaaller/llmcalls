/**
 * Voice Routes - Transfer-Only Mode
 * Handles Twilio voice webhooks for transfer-only phone navigation
 */

import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { TwilioCallStatus, isCallEnded } from '../types/callStatus';
import transferConfig from '../config/transfer-config';
import callStateManager from '../services/callStateManager';
import callHistoryService from '../services/callHistoryService';
import { TransferConfig as TransferConfigType } from '../config/transfer-config';
import {
  buildProcessSpeechUrl,
  createSayAttributes,
  createGatherAttributes,
  getBaseUrl,
} from '../utils/twimlHelpers';
import { processSpeech } from '../services/speechProcessingService';
import { logOnError } from '../utils/logOnError';

const router: express.Router = express.Router();

// Constants
/**
 * Default timeout for Twilio Gather speech input (in seconds)
 * This is the maximum time to wait for speech to START, not recording duration.
 * Once speech starts, Twilio records until there's a 2-second pause (speechTimeout: 'auto').
 * Increased to 15 seconds to capture longer IVR menus.
 */
const DEFAULT_SPEECH_TIMEOUT = 15;

/**
 * Initial voice webhook - called when call starts
 */
router.post('/', (req: Request, res: Response): void => {
  try {
    const callSid = req.body.CallSid;
    const baseUrl = getBaseUrl(req);

    const config = transferConfig.createConfig({
      transferNumber:
        (req.query.transferNumber as string) ||
        process.env.TRANSFER_PHONE_NUMBER,
      userPhone:
        (req.query.userPhone as string) || process.env.USER_PHONE_NUMBER,
      userEmail: (req.query.userEmail as string) || process.env.USER_EMAIL,
      callPurpose:
        (req.query.callPurpose as string) ||
        process.env.CALL_PURPOSE ||
        'speak with a representative',
      customInstructions: (req.query.customInstructions as string) || '',
    });

    const skipInfoRequests = req.query.skipInfoRequests === 'true';

    callStateManager.updateCallState(callSid, {
      transferConfig: config as TransferConfigType,
      previousMenus: [],
      customInstructions: config.customInstructions,
      userPhone: config.userPhone,
      ...(skipInfoRequests && { skipInfoRequests }),
    });

    logOnError(
      callHistoryService.startCall(callSid, {
        to: req.body.To || req.body.Called,
        from: req.body.From || req.body.Caller,
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose,
        customInstructions: config.customInstructions,
      }),
      'Error starting call history'
    );

    const response = new twilio.twiml.VoiceResponse();
    const recordingCallbackUrl = `${baseUrl}/voice/recording-status`;
    response.start().recording({
      recordingStatusCallback: recordingCallbackUrl,
      recordingStatusCallbackEvent: ['completed'],
      trim: 'do-not-trim',
    } as any);
    const initialProcessSpeechUrl = buildProcessSpeechUrl({
      baseUrl,
      config,
      additionalParams: { firstCall: 'true' },
    });
    const gatherAttributes = createGatherAttributes(config, {
      action: initialProcessSpeechUrl,
      method: 'POST',
      enhanced: true,
      timeout: DEFAULT_SPEECH_TIMEOUT,
    });
    response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
    // If Gather times out (IVR hasn't spoken yet), keep listening
    response.redirect({ method: 'POST' }, initialProcessSpeechUrl);

    res.type('text/xml');
    res.send(response.toString());
    return;
  } catch (error) {
    void (error instanceof Error ? error.message : String(error));
    const response = new twilio.twiml.VoiceResponse();
    response.say(
      { voice: 'alice', language: 'en-US' },
      'I apologize, but there was an error. Please try again later.'
    );
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
  }
});

/**
 * Process speech - main conversation handler
 */
router.post(
  '/process-speech',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const callSid = req.body.CallSid;
      const speechResult = req.body.SpeechResult || '';
      const confidence = req.body.Confidence || '';
      const isFirstCall = req.query.firstCall === 'true';
      const baseUrl = getBaseUrl(req);

      console.log(`[STT] confidence=${confidence} "${speechResult}"`);

      const result = await processSpeech({
        callSid,
        speechResult,
        isFirstCall,
        baseUrl,
        transferNumber: req.query.transferNumber as string | undefined,
        callPurpose: req.query.callPurpose as string | undefined,
        customInstructions: req.query.customInstructions as string | undefined,
        userPhone: req.query.userPhone as string | undefined,
        userEmail: req.query.userEmail as string | undefined,
      });

      if (result.shouldSend) {
        res.type('text/xml');
        res.send(result.twiml);
      }
    } catch (error) {
      void (error instanceof Error ? error.message : String(error));

      const errorResponse = new twilio.twiml.VoiceResponse();
      errorResponse.say(
        { voice: 'alice', language: 'en-US' },
        'I apologize, but an application error has occurred. Please try again later.'
      );
      errorResponse.hangup();
      res.type('text/xml');
      res.send(errorResponse.toString());
    }
  }
);

/**
 * Process DTMF - handle DTMF key presses
 */
router.post('/process-dtmf', (req: Request, res: Response) => {
  void (req.body.Digits || req.query.Digits);
  const baseUrl = getBaseUrl(req);

  const callSid = req.body.CallSid;
  const callState = callStateManager.getCallState(callSid);
  const customInstructionsFromState = callState.customInstructions;
  const customInstructionsFromQuery = req.query.customInstructions as
    | string
    | undefined;
  const finalCustomInstructions =
    customInstructionsFromQuery || customInstructionsFromState || '';

  const config = transferConfig.createConfig({
    transferNumber:
      (req.query.transferNumber as string) || process.env.TRANSFER_PHONE_NUMBER,
    callPurpose:
      (req.query.callPurpose as string) ||
      process.env.CALL_PURPOSE ||
      'speak with a representative',
    customInstructions: finalCustomInstructions,
  });

  if (finalCustomInstructions) {
    callStateManager.updateCallState(callSid, {
      customInstructions: finalCustomInstructions,
    });
  }

  const digit = (req.query.Digits as string) || req.body.Digits;
  const response = new twilio.twiml.VoiceResponse();

  if (digit) {
    console.log('[process-dtmf] Sending DTMF digit:', digit);
    response.play({ digits: digit });
  }

  const gatherAttributes = createGatherAttributes(config, {
    action: buildProcessSpeechUrl({ baseUrl, config }),
    method: 'POST',
    enhanced: true,
    timeout: DEFAULT_SPEECH_TIMEOUT,
    input: ['dtmf', 'speech'],
    numDigits: 1,
  });
  response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Recording status callback - Twilio POSTs when a call recording is completed
 */
router.post('/recording-status', async (req: Request, res: Response) => {
  const callSid = req.body.CallSid;
  const recordingUrl = req.body.RecordingUrl;
  const recordingStatus = req.body.RecordingStatus;
  if (callSid && recordingUrl && recordingStatus === 'completed') {
    await callHistoryService.setRecordingUrl(callSid, recordingUrl);
  }
  res.status(200).send('OK');
});

/**
 * Call status callback - handles status updates from Twilio for main calls
 */
router.post('/call-status', (req: Request, res: Response) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus as TwilioCallStatus | undefined;

  if (callSid && callStatus) {
    if (callStatus === 'completed') {
      logOnError(
        callHistoryService.endCall(callSid, 'completed'),
        'Error ending call'
      );
    } else if (isCallEnded(callStatus)) {
      logOnError(
        callHistoryService.endCall(callSid, 'failed'),
        'Error ending call'
      );
    }
  }

  res.status(200).send('OK');
});

/**
 * Stall loop — redirects to itself every ~6 seconds while waiting for user info.
 * Breaks out when the user's reply arrives in call state or after 2-minute timeout.
 */
router.post('/stall', (req: Request, res: Response): void => {
  const callSid = req.body.CallSid || (req.query.callSid as string);
  const baseUrl = getBaseUrl(req);
  const response = new twilio.twiml.VoiceResponse();

  if (!callSid) {
    response.say({ voice: 'alice', language: 'en-US' }, 'An error occurred.');
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  const callState = callStateManager.getCallState(callSid);
  const pending = callState.pendingInfoRequest;

  // If user has replied, break out of stall
  if (pending?.userResponse) {
    console.log(
      `✅ Info received (${pending.respondedVia}): ${pending.userResponse}`
    );

    callHistoryService
      .addInfoResponse(
        callSid,
        pending.userResponse,
        pending.respondedVia || 'web'
      )
      .catch(err => console.error('Error logging info response:', err));

    const config = transferConfig.createConfig({
      transferNumber:
        callState.transferConfig?.transferNumber ||
        process.env.TRANSFER_PHONE_NUMBER,
      callPurpose:
        callState.transferConfig?.callPurpose || process.env.CALL_PURPOSE,
      customInstructions: callState.customInstructions,
    });

    const sayAttributes = createSayAttributes(config);

    // Determine how to provide the info based on dataEntryMode
    const dataEntryMode = pending.dataEntryMode || 'speech';
    const digits = pending.userResponse.replace(/\D/g, '');

    if (dataEntryMode === 'dtmf' && digits.length > 0) {
      response.play({ digits: `w${digits}` });
    } else {
      response.say(
        sayAttributes as Parameters<typeof response.say>[0],
        pending.userResponse
      );
    }

    // Clear pending request
    callState.pendingInfoRequest = undefined;

    // Resume normal gather flow
    const gatherAttributes = createGatherAttributes(config, {
      action: buildProcessSpeechUrl({ baseUrl, config }),
      method: 'POST',
      enhanced: true,
      timeout: DEFAULT_SPEECH_TIMEOUT,
    });
    response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  // Check 2-minute timeout
  const STALL_TIMEOUT_MS = 2 * 60 * 1000;
  if (
    pending &&
    Date.now() - pending.requestedAt.getTime() > STALL_TIMEOUT_MS
  ) {
    console.log('⏰ Stall timeout — giving up on info request');

    callState.pendingInfoRequest = undefined;

    const config = transferConfig.createConfig({
      transferNumber:
        callState.transferConfig?.transferNumber ||
        process.env.TRANSFER_PHONE_NUMBER,
      callPurpose:
        callState.transferConfig?.callPurpose || process.env.CALL_PURPOSE,
      customInstructions: callState.customInstructions,
    });
    const sayAttributes = createSayAttributes(config);
    response.say(
      sayAttributes as Parameters<typeof response.say>[0],
      "I don't have that information. Can I speak with a representative?"
    );

    const gatherAttributes = createGatherAttributes(config, {
      action: buildProcessSpeechUrl({ baseUrl, config }),
      method: 'POST',
      enhanced: true,
      timeout: DEFAULT_SPEECH_TIMEOUT,
    });
    response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  // Still waiting — use Gather (not Redirect) to cycle back.
  // Gather→action is a new HTTP request, not a TwiML redirect,
  // so it doesn't count toward Twilio's ~20 redirect limit.
  response.say({ voice: 'Polly.Matthew', language: 'en-US' }, 'Just a moment.');
  const stallUrl = `${baseUrl}/voice/stall?callSid=${callSid}`;
  response.gather({
    input: ['speech'] as any,
    timeout: 5,
    action: stallUrl,
    method: 'POST',
  } as any);

  res.type('text/xml');
  res.send(response.toString());
});

/**
 * SMS reply webhook — Twilio POSTs here when user replies via SMS.
 * Finds the active call by phone number and resolves the pending info request.
 */
router.post('/sms-reply', (req: Request, res: Response): void => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();

  const response = new twilio.twiml.MessagingResponse();

  if (!body) {
    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  const callSid = callStateManager.findCallByUserPhone(from);
  if (!callSid) {
    // No active call with pending request for this number
    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  const resolved = callStateManager.resolveInfoRequest(callSid, body, 'sms');
  if (resolved) {
    console.log(`📱 SMS reply from ${from}: "${body}" → call ${callSid}`);
    response.message('Got it! Continuing your call now.');
  }

  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Transfer status callback
 */
router.post('/transfer-status', (req: Request, res: Response) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus as TwilioCallStatus | undefined;

  if (callSid && callStatus) {
    if (callStatus === 'completed') {
      logOnError(
        callHistoryService.updateTransferStatus(callSid, true),
        'Error updating transfer status'
      );
    } else if (isCallEnded(callStatus)) {
      logOnError(
        callHistoryService.updateTransferStatus(callSid, false),
        'Error updating transfer status'
      );
    }

    if (isCallEnded(callStatus)) {
      const internalStatus: 'completed' | 'failed' =
        callStatus === 'completed' ? 'completed' : 'failed';
      logOnError(
        callHistoryService.endCall(callSid, internalStatus),
        'Error ending call'
      );
    }
  }

  const response = new twilio.twiml.VoiceResponse();
  res.type('text/xml');
  res.send(response.toString());
});

export default router;
