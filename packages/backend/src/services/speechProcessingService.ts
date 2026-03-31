/**
 * Speech Processing Service
 * Main function used by BOTH route handler and eval service.
 * Orchestrates full speech processing: state management, AI decisions, and Telnyx API calls.
 */

import callStateManager from './callStateManager';
import callHistoryService from './callHistoryService';
import ivrNavigatorService, { CallAction } from './ivrNavigatorService';
import telnyxService from './telnyxService';
import transferConfig from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { DTMFDecision, VoiceProcessingResult } from '../types/voiceProcessing';

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
  skipInfoRequests?: boolean;
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

function getTelnyxVoice(aiVoice?: string): string {
  if (aiVoice?.startsWith('Polly.')) {
    return `AWS.${aiVoice}-Neural`;
  }
  return aiVoice || 'AWS.Polly.Matthew-Neural';
}

/**
 * Process a speech turn end-to-end.
 * Used by both the transcription webhook handler and eval service (testMode).
 */
export async function processSpeech({
  callSid,
  speechResult,
  isFirstCall: _isFirstCall,
  baseUrl: _baseUrl,
  transferNumber,
  callPurpose,
  customInstructions,
  userPhone,
  userEmail,
  testMode = false,
  skipInfoRequests,
}: ProcessSpeechParams): Promise<ProcessSpeechResult> {
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
      skipInfoRequests: skipInfoRequests ?? callState.skipInfoRequests,
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

    // ── 3b. Store detected menu options for loop detection ───────────────────
    const detectedMenuOptions = action.detected.menuOptions as MenuOption[];
    if (detectedMenuOptions.length > 0) {
      callStateManager.updateCallState(callSid, {
        previousMenus: [
          ...(callState.previousMenus || []),
          detectedMenuOptions,
        ],
      });
    }

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

        await telnyxService.speakText(
          callSid,
          'Thank you. Goodbye.',
          getTelnyxVoice(config.aiSettings.voice)
        );
        await telnyxService.terminateCall(callSid);
        callStateManager.clearCallState(callSid);
      }
      return {
        twiml: '',
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
          .addTransfer(callSid, config.transferNumber, false)
          .catch(err => console.error('Error adding transfer:', err));

        // Transfer immediately — no speech delay, the human agent hangs up within seconds
        await telnyxService.transfer(callSid, config.transferNumber);
      }
      return {
        twiml: '',
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
        callStateManager.updateCallState(callSid, { isSpeaking: true });
        await telnyxService.speakText(
          callSid,
          'Hey, are you a real person?',
          getTelnyxVoice(config.aiSettings.voice)
        );
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5c. Handle request_info → stall + notify user ───────────────────────
    // Backend guard: if skipInfoRequests is on, override request_info → speak
    if (
      action.action === 'request_info' &&
      (skipInfoRequests ?? callState.skipInfoRequests)
    ) {
      action.action = 'speak';
      action.speech = "I don't have that information";
      action.reason = `request_info blocked by skipInfoRequests (wanted: ${action.requestedInfo})`;
      action.requestedInfo = undefined;
    }

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
          telnyxService
            .sendSMS(
              userPhoneNumber,
              `Your call needs: ${requestedInfo}. Reply with the info to continue the call.`
            )
            .then(() => console.log(`📱 SMS sent to ${userPhoneNumber}`))
            .catch(err =>
              console.error('SMS send failed (non-blocking):', err)
            );
        }

        callStateManager.updateCallState(callSid, { isSpeaking: true });
        await telnyxService.speakText(
          callSid,
          'One moment, let me look that up.',
          getTelnyxVoice(config.aiSettings.voice)
        );
        callStateManager.updateCallState(callSid, { isSpeaking: false });

        // Dynamically import to avoid circular dependency
        const { startStallTimer } = await import('../routes/voiceRoutes');
        startStallTimer(callSid);
      }

      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 6. Handle IVR menu / press digit ─────────────────────────────────────
    if (action.action === 'press_digit' && action.digit) {
      const menuOptions = action.detected.menuOptions as MenuOption[];

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

        await telnyxService.sendDTMF(callSid, action.digit);
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
        digitPressed: action.digit,
      };
    }

    // ── 7. Handle wait (incomplete menu, silence, etc.) ──────────────────────
    if (action.action === 'wait') {
      if (action.detected.transferRequested || action.detected.holdDetected) {
        callStateManager.updateCallState(callSid, {
          transferAnnounced: true,
        });
      }

      if (action.detected.holdDetected && !testMode) {
        console.log(`📞 Hold queue detected: ${action.reason}`);
        callHistoryService
          .addHoldDetected(callSid)
          .catch(err => console.error('Error adding hold event:', err));
      }

      if (action.detected.isIVRMenu && !action.detected.isMenuComplete) {
        const menuOptions = action.detected.menuOptions as MenuOption[];
        if (!testMode && menuOptions.length > 0) {
          const menuSummary = `[IVR Menu incomplete - found: ${menuOptions.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`;
          callHistoryService
            .addConversation(callSid, 'system', menuSummary)
            .catch(err => console.error('Error adding conversation:', err));
        }
      }

      // wait: transcription continues; nothing to do on our side
      return {
        twiml: '',
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

          callStateManager.updateCallState(callSid, { isSpeaking: true });
          await telnyxService.speakText(
            callSid,
            formatDigitsForSpeech(dtmfDigits),
            getTelnyxVoice(config.aiSettings.voice)
          );
          callStateManager.updateCallState(callSid, { isSpeaking: false });
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

          await telnyxService.sendDTMF(callSid, `ww${dtmfDigits}`);
        }

        return {
          twiml: '',
          shouldSend: !testMode,
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

        callStateManager.updateCallState(callSid, { isSpeaking: true });
        await telnyxService.speakText(
          callSid,
          aiResponse,
          getTelnyxVoice(config.aiSettings.voice)
        );
        callStateManager.updateCallState(callSid, { isSpeaking: false });
      }
    }

    return {
      twiml: '',
      shouldSend: !testMode,
      processingResult: result,
      aiAction: action.action,
      aiResponse,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!testMode) {
      console.error('❌ Error in processSpeech:', errorMessage);
      try {
        await telnyxService.speakText(
          callSid,
          'I apologize, but an application error has occurred. Please try again later.'
        );
        await telnyxService.terminateCall(callSid);
      } catch {
        // Best effort — call may already be ended
      }
    }
    return { twiml: '', shouldSend: !testMode };
  }
}
