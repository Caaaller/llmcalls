/**
 * Speech Processing Service
 * Main function used by BOTH route handler and eval service.
 * Orchestrates full speech processing: state management, AI decisions, and Telnyx API calls.
 */

import callStateManager from './callStateManager';
import callHistoryService from './callHistoryService';
import { EndReason } from '../models/CallHistory';
import ivrNavigatorService, { CallAction } from './ivrNavigatorService';
import telnyxService from './telnyxService';
import transferConfig from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { DTMFDecision, VoiceProcessingResult } from '../types/voiceProcessing';

/**
 * Map the AI's terminationReason to a structured endReason enum value.
 * Unknown / missing reasons fall through to 'ai_hangup_dead_end'.
 */
function mapTerminationReasonToEndReason(
  terminationReason: string | undefined
): EndReason {
  switch (terminationReason) {
    case 'voicemail':
      return 'ai_hangup_voicemail';
    case 'closed_no_menu':
      return 'ai_hangup_closed';
    case 'dead_end':
      return 'ai_hangup_dead_end';
    default:
      return 'ai_hangup_dead_end';
  }
}

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
  _sttDoneAt?: number;
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
 * Space out any multi-digit sequence in a sentence so TTS speaks numbers one
 * digit at a time. IVRs with speech recognition expect digit-by-digit cadence;
 * saying "35142679" as a single number causes "I didn't hear anything" loops.
 *
 * Handles common number formats:
 *   "35142679"         → "3 5 1 4 2 6 7 9"
 *   "720-584-6358"     → "7 2 0 5 8 4 6 3 5 8"
 *   "ID is 12345"      → "ID is 1 2 3 4 5"
 *   "press 1"          → "press 1"          (single digit untouched)
 *   "March 6th 1998"   → "March 6th 1 9 9 8"
 */
export function spaceOutNumbers(text: string): string {
  // Match runs of 2+ digits, allowing dashes/spaces as separators between them.
  // (Parens intentionally excluded so "(720)" keeps its parens — we only rewrite
  // inside the digit run.)
  return text.replace(/\d[\d\- ]*\d/g, match => {
    const digitsOnly = match.replace(/[^\d]/g, '');
    return digitsOnly.split('').join(' ');
  });
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
  return aiVoice || 'Telnyx.KokoroTTS.am_michael';
}

async function speakAndLog(
  callSid: string,
  text: string,
  voice: string
): Promise<void> {
  // The call-ended short-circuit lives in telnyxService.guardedAction now —
  // single source of truth. speakText will no-op if the call is tombstoned.
  callHistoryService
    .addConversation(callSid, 'ai', text)
    .catch(err => console.error('Error adding conversation:', err));
  callStateManager.updateCallState(callSid, { isSpeaking: true });
  // Reset silent-hold timer — AI speech counts as activity, not silence
  const { resetSilentHoldTimer } = await import('../routes/streamRoutes');
  resetSilentHoldTimer(callSid);
  await telnyxService.speakText(callSid, text, voice);
  callStateManager.updateCallState(callSid, { isSpeaking: false });
  resetSilentHoldTimer(callSid);
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
  _sttDoneAt,
}: ProcessSpeechParams): Promise<ProcessSpeechResult> {
  try {
    const enterAt = Date.now();
    if (_sttDoneAt) {
      console.log(`⏱️ STT→processSpeech: ${enterAt - _sttDoneAt}ms`);
    }
    if (!callSid) throw new Error('Call SID is missing');

    // ── 1. State & config setup ──────────────────────────────────────────────
    const callState = callStateManager.getCallState(callSid);

    // If we've already initiated a transfer, ignore further speech — the call is handed off.
    if (callState.transferInitiated && !testMode) {
      console.log(
        `🔇 Ignoring speech after transfer initiated: "${speechResult.slice(0, 60)}"`
      );
      return { twiml: '', shouldSend: false };
    }
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

    const actionHistory = callState.actionHistory || [];

    // ── 2. Single AI call ────────────────────────────────────────────────────
    const conversationHistory = callState.conversationHistory || [];

    const aiStartAt = Date.now();
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
      awaitingHumanConfirmation: callState.awaitingHumanConfirmation,
      awaitingHumanClarification: callState.awaitingHumanClarification,
      skipInfoRequests: skipInfoRequests ?? callState.skipInfoRequests,
    });

    const aiDoneAt = Date.now();
    // Full AI decision log — so we can diagnose why the AI chose a given action without
    // needing to add phrase-matching overrides later.
    console.log(
      `🤖 AI DECISION (${aiDoneAt - aiStartAt}ms):\n` +
        `   IVR heard: "${speechResult.slice(0, 150)}"\n` +
        `   Action: ${action.action}${action.digit ? ` digit=${action.digit}` : ''}${action.speech ? ` speech="${action.speech}"` : ''}\n` +
        `   Reason: ${action.reason}\n` +
        `   Detected: isIVRMenu=${action.detected.isIVRMenu} hold=${action.detected.holdDetected} loop=${action.detected.loopDetected} transferReq=${action.detected.transferRequested} humanIntro=${action.detected.humanIntroDetected}\n` +
        `   State: awaitConf=${!!callState.awaitingHumanConfirmation} awaitClar=${!!callState.awaitingHumanClarification} transferred=${!!callState.transferInitiated}`
    );

    // ── Backend enforcement ─────────────────────────────────────────────────
    // No regex/phrase-matching on speech. Only enforce consistency with flags the
    // AI ITSELF set in the response — the AI made the judgment, we just ensure its
    // declared action matches its declared observations.

    const confirmationPending =
      !!callState.awaitingHumanConfirmation ||
      !!callState.awaitingHumanClarification;

    // Structural gate: human_detected is only valid when a confirmation question
    // is already pending. Otherwise downgrade to maybe_human so the system asks
    // "Am I speaking with a live agent?" first. No exceptions.
    if (action.action === 'human_detected' && !confirmationPending) {
      console.log(
        `⚠️ human_detected without pending confirmation → maybe_human (was human_detected on speech: "${speechResult.slice(0, 80)}")`
      );
      action.action = 'maybe_human';
    }

    // Consistency check: if the AI set humanIntroDetected=true (a proper personal
    // introduction), route through the MANDATORY confirmation flow.
    // - No confirmation pending → maybe_human (system will ask "Am I speaking with
    //   a live agent?"). Never fast-path to human_detected on a name alone.
    // - Confirmation already pending → human_detected is fine.
    if (
      action.detected.humanIntroDetected &&
      !confirmationPending &&
      action.action !== 'maybe_human' &&
      action.action !== 'hang_up' &&
      action.action !== 'press_digit'
    ) {
      console.log(
        `⚠️ AI flag consistency: humanIntroDetected=true + no confirmation pending → maybe_human (was ${action.action})`
      );
      action.action = 'maybe_human';
    }

    // Consistency check: if the AI set isIVRMenu=true AND isMenuComplete=true and
    // declared menu options with digits, it should press one. When AI returns "speak"
    // instead, fall back to pressing the lowest digit FROM THE AI'S OWN DECLARED MENU
    // OPTIONS. Do NOT fire this for wait actions — a wait on an IVR menu means the AI
    // believes the menu is incomplete and we should listen for more options.
    if (
      action.detected.isIVRMenu &&
      action.detected.isMenuComplete &&
      action.action === 'speak' &&
      action.detected.menuOptions &&
      action.detected.menuOptions.length > 0
    ) {
      // Sort AI's own menuOptions by digit and pick the lowest valid one.
      const sortedDigits = [...action.detected.menuOptions]
        .map(o => o.digit)
        .filter(d => typeof d === 'string' && /^\d$|^[*#]$/.test(d))
        .sort();
      if (sortedDigits.length > 0) {
        console.log(
          `⚠️ AI flag consistency: isIVRMenu=true + isMenuComplete=true but action=speak → press_digit=${sortedDigits[0]} (using AI's own declared options)`
        );
        action.action = 'press_digit';
        action.digit = sortedDigits[0];
      } else {
        action.action = 'wait';
      }
    }

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

    // Reset silent-hold timer after any action (DTMF press, wait, speak, etc.)
    // The IVR may take time to process DTMF input — that's expected, not hold.
    if (!testMode) {
      const { resetSilentHoldTimer } = await import('../routes/streamRoutes');
      resetSilentHoldTimer(callSid);
    }

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
        const endReason = mapTerminationReasonToEndReason(
          action.detected.terminationReason
        );
        callHistoryService
          .endCall(
            callSid,
            'terminated',
            endReason,
            action.detected.terminationReason || action.reason
          )
          .catch(err => console.error('Error ending call:', err));

        await speakAndLog(
          callSid,
          'Thank you. Goodbye.',
          getTelnyxVoice(config.aiSettings.voice)
        );
        await telnyxService.terminateCall(callSid);
        const { stopSilentHoldTimer } = await import('../routes/streamRoutes');
        stopSilentHoldTimer(callSid);
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

        callStateManager.updateCallState(callSid, {
          awaitingHumanConfirmation: false,
          awaitingHumanClarification: false,
          humanConfirmationAttempts: 0,
          transferInitiated: true,
        });

        // Stop the silent-hold timer — we're handing off, no more hold events on this call
        const { stopSilentHoldTimer } = await import('../routes/streamRoutes');
        stopSilentHoldTimer(callSid);

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
        await speakAndLog(
          callSid,
          'Hi, am I speaking with a live agent?',
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

    // ── 5c. Handle maybe_human_unclear → ask clarification ──────────────────
    if (action.action === 'maybe_human_unclear') {
      if (!testMode) {
        console.log(
          `❓ Unclear response to confirmation, asking clarification: ${action.reason}`
        );
      }

      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: false,
        awaitingHumanClarification: true,
      });

      if (!testMode) {
        await speakAndLog(
          callSid,
          "I'm sorry, are you a human or an automated message?",
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

    // ── Reset confirmation state on non-human actions ────────────────────────
    // Keep humanConfirmationAttempts — we track total attempts per call to prevent
    // bots (Walmart, UMR) from triggering infinite confirmation loops.
    if (
      callState.awaitingHumanConfirmation ||
      callState.awaitingHumanClarification
    ) {
      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: false,
        awaitingHumanClarification: false,
      });
    }

    // ── 5d. Handle request_info → stall + notify user ───────────────────────
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

        await speakAndLog(
          callSid,
          'One moment, let me look that up.',
          getTelnyxVoice(config.aiSettings.voice)
        );

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

      // Space out multi-digit numbers so TTS speaks them one digit at a time
      // (IVRs with speech recognition need digit-by-digit cadence).
      const spokenResponse = spaceOutNumbers(aiResponse);
      callStateManager.addToHistory(callSid, {
        type: 'ai',
        text: spokenResponse,
      });
      if (!testMode) {
        const ttsStartAt = Date.now();
        console.log(`⏱️ TTS SEND at ${new Date().toISOString()}`);
        await speakAndLog(
          callSid,
          spokenResponse,
          getTelnyxVoice(config.aiSettings.voice)
        );
        console.log(
          `⏱️ TTS API returned: ${Date.now() - ttsStartAt}ms at ${new Date().toISOString()}`
        );
        if (_sttDoneAt) {
          console.log(`⏱️ TOTAL STT→TTS: ${Date.now() - _sttDoneAt}ms`);
        }
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
        await speakAndLog(
          callSid,
          'I apologize, but an application error has occurred. Please try again later.',
          'Telnyx.KokoroTTS.am_michael'
        );
        await telnyxService.terminateCall(callSid);
      } catch {
        // Best effort — call may already be ended
      }
    }
    return { twiml: '', shouldSend: !testMode };
  }
}
