/**
 * Speech Processing Service
 * Main function used by BOTH route handler and eval service.
 * Orchestrates full speech processing: state management, AI decisions, and TwiML generation.
 */

import twilio from 'twilio';
import callStateManager from './callStateManager';
import callHistoryService from './callHistoryService';
import ivrNavigatorService, { CallAction } from './ivrNavigatorService';
import twilioService from './twilioService';
import transferConfig from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { DTMFDecision, VoiceProcessingResult } from '../types/voiceProcessing';
import {
  buildProcessSpeechUrl,
  createSayAttributes,
  createGatherAttributes,
  DEFAULT_SPEECH_TIMEOUT,
} from '../utils/twimlHelpers';

export interface ProcessSpeechParams {
  callSid: string;
  speechResult: string;
  isFirstCall: boolean;
  baseUrl: string;
  transferNumber?: string;
  callPurpose?: string;
  customInstructions?: string;
  userPhone?: string;
  userEmail?: string;
  testMode?: boolean;
}

export interface ProcessSpeechResult {
  twiml: string;
  shouldSend: boolean;
  processingResult?: VoiceProcessingResult;
  aiAction?: string;
  aiResponse?: string;
  digitPressed?: string;
}

/**
 * Extract pure digits from text (e.g., "90001", "720-584-6358" → "7205846358").
 */
function extractDTMFDigits(text: string): string | null {
  const stripped = text.replace(/[\s\-().+]/g, '');
  if (stripped.length >= 3 && /^\d+$/.test(stripped)) {
    return stripped;
  }
  return null;
}

function formatDigitsForSpeech(digits: string): string {
  return digits.split('').join(' ');
}

/**
 * Map a CallAction from the unified AI into the backward-compatible VoiceProcessingResult
 */
function mapActionToProcessingResult(
  action: CallAction,
  callPurpose: string
): VoiceProcessingResult {
  const dtmfDecision: DTMFDecision = {
    callPurpose,
    shouldPress: action.action === 'press_digit' && !!action.digit,
    digit: action.action === 'press_digit' ? action.digit || null : null,
    matchedOption: action.reason,
    matchType: action.detected.isIVRMenu ? 'semantic' : 'fallback',
    reason: action.reason,
  };

  return {
    isIVRMenu: action.detected.isIVRMenu,
    menuOptions: action.detected.menuOptions as MenuOption[],
    isMenuComplete: action.detected.isMenuComplete,
    loopDetected: action.detected.loopDetected,
    shouldTerminate: action.action === 'hang_up',
    terminationReason: action.detected.terminationReason,
    transferRequested: action.detected.transferRequested,
    transferConfidence: action.detected.transferConfidence,
    transferReason: action.reason,
    dtmfDecision,
    shouldPreventDTMF:
      action.detected.loopDetected && action.action !== 'press_digit',
  };
}

/**
 * Process a speech turn end-to-end.
 * Used by both route handler (with TwiML) and eval service (test mode).
 */
export async function processSpeech({
  callSid,
  speechResult,
  isFirstCall: _isFirstCall,
  baseUrl,
  transferNumber,
  callPurpose,
  customInstructions,
  userPhone,
  userEmail,
  testMode = false,
}: ProcessSpeechParams): Promise<ProcessSpeechResult> {
  const response = new twilio.twiml.VoiceResponse();

  try {
    if (!callSid) throw new Error('Call SID is missing');

    // ── 1. State & config setup ──────────────────────────────────────────────
    const callState = callStateManager.getCallState(callSid);
    const existing = callState.transferConfig;
    const finalCustomInstructions =
      customInstructions ||
      existing?.customInstructions ||
      callState.customInstructions ||
      '';

    const config = transferConfig.createConfig({
      transferNumber:
        transferNumber ||
        existing?.transferNumber ||
        process.env.TRANSFER_PHONE_NUMBER,
      userPhone:
        userPhone || existing?.userPhone || process.env.USER_PHONE_NUMBER,
      userEmail: userEmail || existing?.userEmail || process.env.USER_EMAIL,
      callPurpose:
        callPurpose ||
        existing?.callPurpose ||
        process.env.CALL_PURPOSE ||
        'speak with a representative',
      customInstructions: finalCustomInstructions,
    });

    if (finalCustomInstructions || config.userPhone) {
      callStateManager.updateCallState(callSid, {
        ...(finalCustomInstructions && {
          customInstructions: finalCustomInstructions,
        }),
        ...(config.userPhone && { userPhone: config.userPhone }),
      });
    }

    if (!testMode) {
      console.log('👤', speechResult);
    }

    if (!testMode) {
      callHistoryService
        .addConversation(callSid, 'user', speechResult)
        .catch(err => console.error('Error adding conversation:', err));
    }

    // ── 2. Single AI call ────────────────────────────────────────────────────
    const conversationHistory = callState.conversationHistory || [];
    const actionHistory = callState.actionHistory || [];

    const action = await ivrNavigatorService.decideAction({
      config,
      conversationHistory: conversationHistory.map(h => ({
        type: h.type,
        text: h.text || '',
      })),
      actionHistory,
      currentSpeech: speechResult,
      previousMenus: callState.previousMenus || [],
      lastPressedDTMF: callState.lastPressedDTMF,
      callPurpose: config.callPurpose,
      transferAnnounced: callState.transferAnnounced,
      awaitingHumanConfirmation: callState.awaitingHumanConfirmation,
    });

    const result = mapActionToProcessingResult(
      action,
      config.callPurpose || 'speak with a representative'
    );

    // ── 3. Record this turn in action history ────────────────────────────────
    callStateManager.addActionToHistory(callSid, {
      turnNumber: actionHistory.length + 1,
      ivrSpeech: speechResult,
      action: action.action,
      digit: action.digit,
      speech: action.speech,
      reason: action.reason,
    });

    // ── 4. Handle termination ────────────────────────────────────────────────
    if (action.action === 'hang_up') {
      if (!testMode) {
        console.log(
          `🛑 Call Terminated: ${action.detected.terminationReason || action.reason}`
        );
        callHistoryService
          .addTermination(
            callSid,
            action.detected.terminationReason || action.reason
          )
          .catch(err => console.error('Error adding termination:', err));
        callHistoryService
          .endCall(callSid, 'terminated')
          .catch(err => console.error('Error ending call:', err));

        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          'Thank you. Goodbye.'
        );
        response.hangup();
        callStateManager.clearCallState(callSid);
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5. Handle human confirmed → dial user ─────────────────────────────────
    if (action.action === 'human_detected') {
      if (!testMode) {
        console.log(`🔄 Human confirmed, dialing user: ${action.reason}`);
        callHistoryService
          .addTransfer(callSid, config.transferNumber, true)
          .catch(err => console.error('Error adding transfer:', err));

        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          'Ok, one second please.'
        );
        response.pause({ length: 1 });
        const dial = response.dial({
          action: `${baseUrl}/voice/transfer-status`,
          method: 'POST',
          timeout: 30,
        });
        (dial as any).answerOnMedia = true;
        dial.number(config.transferNumber);
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5b. Handle maybe_human → ask confirmation ────────────────────────────
    if (action.action === 'maybe_human') {
      if (!testMode) {
        console.log(
          `❓ Maybe human detected, asking confirmation: ${action.reason}`
        );
      }

      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: true,
      });

      if (!testMode) {
        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          'Hey, are you a real person?'
        );

        const gatherAttributes = createGatherAttributes(config, {
          action: buildProcessSpeechUrl({ baseUrl, config }),
          method: 'POST',
          enhanced: true,
          timeout: DEFAULT_SPEECH_TIMEOUT,
        });
        response.gather(
          gatherAttributes as Parameters<typeof response.gather>[0]
        );
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5c. Handle request_info → stall + notify user ───────────────────────
    if (action.action === 'request_info' && action.requestedInfo) {
      const requestedInfo = action.requestedInfo;

      callStateManager.setPendingInfoRequest(
        callSid,
        requestedInfo,
        action.detected.dataEntryMode
      );

      if (!testMode) {
        console.log(`📋 Info requested: ${requestedInfo}`);

        callHistoryService
          .addInfoRequest(callSid, requestedInfo)
          .catch(err => console.error('Error logging info request:', err));

        // Fire-and-forget SMS to user
        const userPhoneNumber =
          config.userPhone || process.env.USER_PHONE_NUMBER;
        if (userPhoneNumber) {
          twilioService
            .sendSMS(
              userPhoneNumber,
              `Your call needs: ${requestedInfo}. Reply with the info to continue the call.`
            )
            .then(() => console.log(`📱 SMS sent to ${userPhoneNumber}`))
            .catch(err =>
              console.error('SMS send failed (non-blocking):', err)
            );
        }

        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          'One moment, let me look that up.'
        );
        response.redirect(`${baseUrl}/voice/stall?callSid=${callSid}`);
      }

      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 6. Handle IVR menu / press digit ─────────────────────────────────────
    if (action.action === 'press_digit' && action.digit) {
      const menuOptions = action.detected.menuOptions as MenuOption[];

      // Update menu state
      if (menuOptions.length > 0) {
        if (!testMode) {
          callHistoryService.addIVRMenu(callSid, menuOptions);
        }
        callStateManager.updateCallState(callSid, {
          lastMenuOptions: menuOptions,
          previousMenus: [...(callState.previousMenus || []), menuOptions],
          menuLevel: (callState.menuLevel || 0) + 1,
        });
      }

      if (!testMode) {
        console.log(`🔢 Pressed DTMF: ${action.digit} - ${action.reason}`);
      }

      callStateManager.updateCallState(callSid, {
        lastPressedDTMF: action.digit,
      });

      if (!testMode) {
        callHistoryService
          .addDTMF(callSid, action.digit, `AI selected: ${action.reason}`)
          .catch(err => console.error('Error adding DTMF:', err));

        response.play({ digits: action.digit });
        response.redirect(
          `${baseUrl}/voice/process-dtmf?Digits=${action.digit}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`
        );
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
        digitPressed: action.digit,
      };
    }

    // ── 7. Handle wait (incomplete menu, silence, etc.) ──────────────────────
    if (action.action === 'wait') {
      // If transfer was announced, mark it in state
      if (action.detected.transferRequested) {
        callStateManager.updateCallState(callSid, {
          transferAnnounced: true,
        });
      }

      // If hold queue detected, record it
      if (action.detected.holdDetected && !testMode) {
        console.log(`📞 Hold queue detected: ${action.reason}`);
        callHistoryService
          .addHoldDetected(callSid)
          .catch(err => console.error('Error adding hold event:', err));
      }

      // If menu detected but incomplete, track it
      if (action.detected.isIVRMenu && !action.detected.isMenuComplete) {
        const menuOptions = action.detected.menuOptions as MenuOption[];
        if (!testMode && menuOptions.length > 0) {
          const menuSummary = `[IVR Menu incomplete - found: ${menuOptions.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`;
          callHistoryService
            .addConversation(callSid, 'system', menuSummary)
            .catch(err => console.error('Error adding conversation:', err));
        }
      }

      if (!testMode) {
        const processSpeechUrl = buildProcessSpeechUrl({ baseUrl, config });
        const gatherAttributes = createGatherAttributes(config, {
          action: processSpeechUrl,
          method: 'POST',
          enhanced: true,
          timeout: DEFAULT_SPEECH_TIMEOUT,
        });
        response.gather(
          gatherAttributes as Parameters<typeof response.gather>[0]
        );
        response.redirect({ method: 'POST' }, processSpeechUrl);
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 8. Handle speak (AI conversational response) ─────────────────────────
    const aiResponse = action.speech || '';

    if (!testMode) {
      if (
        aiResponse &&
        aiResponse.trim().toLowerCase() !== 'silent' &&
        aiResponse.trim().length > 0
      ) {
        console.log('🤖', aiResponse);
      } else {
        console.log('🤖 Silent (no response generated)');
      }
    }

    callStateManager.addToHistory(callSid, {
      type: 'user',
      text: speechResult,
    });

    if (
      aiResponse &&
      aiResponse.trim().toLowerCase() !== 'silent' &&
      aiResponse.trim().length > 0
    ) {
      const dtmfDigits = extractDTMFDigits(aiResponse.trim());

      if (dtmfDigits && !testMode) {
        const dataEntryMode = action.detected.dataEntryMode || 'dtmf';

        if (dataEntryMode === 'speech') {
          callStateManager.addToHistory(callSid, {
            type: 'ai',
            text: `[Spoken digits: ${dtmfDigits}]`,
          });
          callHistoryService
            .addConversation(callSid, 'ai', formatDigitsForSpeech(dtmfDigits))
            .catch(err => console.error('Error adding conversation:', err));

          const sayAttributes = createSayAttributes(config);
          response.say(
            sayAttributes as Parameters<typeof response.say>[0],
            formatDigitsForSpeech(dtmfDigits)
          );
        } else {
          console.log(
            `🔢 Data entry DTMF: ${dtmfDigits} (from AI response "${aiResponse.trim()}")`
          );
          callStateManager.addToHistory(callSid, {
            type: 'ai',
            text: `[DTMF data entry: ${dtmfDigits}]`,
          });
          callHistoryService
            .addDTMF(callSid, dtmfDigits, 'AI data entry response')
            .catch(err => console.error('Error adding DTMF:', err));

          response.play({ digits: `w${dtmfDigits}` });
        }

        const dtmfProcessSpeechUrl = buildProcessSpeechUrl({ baseUrl, config });
        const gatherAttributes = createGatherAttributes(config, {
          action: dtmfProcessSpeechUrl,
          method: 'POST',
          enhanced: true,
          timeout: DEFAULT_SPEECH_TIMEOUT,
        });
        response.gather(
          gatherAttributes as Parameters<typeof response.gather>[0]
        );
        response.redirect({ method: 'POST' }, dtmfProcessSpeechUrl);

        return {
          twiml: response.toString(),
          shouldSend: true,
          processingResult: result,
          aiAction: action.action,
          digitPressed: dtmfDigits,
        };
      }

      callStateManager.addToHistory(callSid, { type: 'ai', text: aiResponse });
      if (!testMode) {
        callHistoryService
          .addConversation(callSid, 'ai', aiResponse)
          .catch(err => console.error('Error adding conversation:', err));

        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          aiResponse
        );
      }
    }

    if (!testMode) {
      const processSpeechUrl = buildProcessSpeechUrl({ baseUrl, config });
      const gatherAttributes = createGatherAttributes(config, {
        action: processSpeechUrl,
        method: 'POST',
        enhanced: true,
        timeout: DEFAULT_SPEECH_TIMEOUT,
      });
      response.gather(
        gatherAttributes as Parameters<typeof response.gather>[0]
      );
      // If Gather times out (no speech), redirect back to keep listening
      // instead of silently ending the call
      response.redirect({ method: 'POST' }, processSpeechUrl);
    }

    return {
      twiml: response.toString(),
      shouldSend: !testMode,
      processingResult: result,
      aiAction: action.action,
      aiResponse,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!testMode) {
      console.error('❌ Error in processSpeech:', errorMessage);
    }

    const errorResponse = new twilio.twiml.VoiceResponse();
    errorResponse.say(
      { voice: 'alice', language: 'en-US' },
      'I apologize, but an application error has occurred. Please try again later.'
    );
    errorResponse.hangup();
    return { twiml: errorResponse.toString(), shouldSend: !testMode };
  }
}
