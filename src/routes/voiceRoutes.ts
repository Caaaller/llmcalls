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

const router = express.Router();

// Constants
/**
 * Default timeout for Twilio Gather speech input (in seconds)
 * This is the maximum time to wait for speech to START, not recording duration.
 * Once speech starts, Twilio records until there's a 2-second pause (speechTimeout: 'auto').
 * Increased to 15 seconds to capture longer IVR menus.
 */
const DEFAULT_SPEECH_TIMEOUT = 15;

function redactForLog(value: string | undefined): string {
  if (value == null || value === '') return '';
  if (process.env.NODE_ENV === 'production') return '[REDACTED]';
  return value;
}

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

    callStateManager.updateCallState(callSid, {
      transferConfig: config as TransferConfigType,
      previousMenus: [],
      holdStartTime: null,
      customInstructions: config.customInstructions,
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
    const gatherAttributes = createGatherAttributes(config, {
      action: buildProcessSpeechUrl({
        baseUrl,
        config,
        additionalParams: { firstCall: 'true' },
      }),
      method: 'POST',
      enhanced: true,
      timeout: DEFAULT_SPEECH_TIMEOUT,
    });
    response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

    const sayAttributes = createSayAttributes(config);
    response.say(
      sayAttributes as Parameters<typeof response.say>[0],
      'Thank you. Goodbye.'
    );
    response.hangup();

    res.type('text/xml');
    res.send(response.toString());
    return;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in /voice endpoint:', errorMessage);
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
      const isFirstCall = req.query.firstCall === 'true';
      const baseUrl = getBaseUrl(req);

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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('❌ Error in /process-speech:', errorMessage);

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
  const digits = req.body.Digits || req.query.Digits;
  console.log(`🔢 DTMF processed: ${redactForLog(digits)}`);
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

  if (digits) {
    console.log('🔢 Pressed DTMF:', redactForLog(digits));
  }

  const response = new twilio.twiml.VoiceResponse();
  const gatherAttributes = createGatherAttributes(config, {
    action: buildProcessSpeechUrl({ baseUrl, config }),
    method: 'POST',
    enhanced: true,
    timeout: DEFAULT_SPEECH_TIMEOUT,
  });
  response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

  res.type('text/xml');
  res.send(response.toString());
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
