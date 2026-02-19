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
      previousMenus: [], // Initialize for AI loop detection
      holdStartTime: null,
      customInstructions: config.customInstructions, // Store for persistence
    });

    callHistoryService
      .startCall(callSid, {
        to: req.body.To || req.body.Called,
        from: req.body.From || req.body.Caller,
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose,
        customInstructions: config.customInstructions,
      })
      .catch(err => console.error('Error starting call history:', err));

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
    console.log('🔢 Pressed DTMF:', digits);
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

  // Map Twilio call statuses to our internal statuses
  if (callSid && callStatus) {
    if (callStatus === 'completed') {
      callHistoryService
        .endCall(callSid, 'completed')
        .catch(err => console.error('Error ending call:', err));
    } else if (isCallEnded(callStatus)) {
      callHistoryService
        .endCall(callSid, 'failed')
        .catch(err => console.error('Error ending call:', err));
    }
    // Note: 'ringing', 'in-progress', 'queued' are intermediate states
    // We don't update status for these as the call is still active
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
    // Update transfer event success status based on call status
    if (callStatus === 'completed') {
      callHistoryService
        .updateTransferStatus(callSid, true)
        .catch(err => console.error('Error updating transfer status:', err));
    } else if (isCallEnded(callStatus)) {
      callHistoryService
        .updateTransferStatus(callSid, false)
        .catch(err => console.error('Error updating transfer status:', err));
    }

    // End the call if transfer completed or failed
    if (isCallEnded(callStatus)) {
      // Map to internal status - only 'completed' or 'failed' are valid for endCall
      const internalStatus: 'completed' | 'failed' =
        callStatus === 'completed' ? 'completed' : 'failed';
      callHistoryService
        .endCall(callSid, internalStatus)
        .catch(err => console.error('Error ending call:', err));
    }
  }

  const response = new twilio.twiml.VoiceResponse();
  res.type('text/xml');
  res.send(response.toString());
});

export default router;
