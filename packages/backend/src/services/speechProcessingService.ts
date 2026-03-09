/**
 * Speech Processing Service
 * Main function used by BOTH route handler and eval service.
 * Orchestrates full speech processing: state management, AI decisions, and TwiML generation.
 */

import twilio from 'twilio';
import callStateManager, { CallState } from './callStateManager';
import callHistoryService from './callHistoryService';
import aiService, { TransferConfig } from './aiService';
import aiDetectionService from './aiDetectionService';
import { DTMFDecision } from './aiDTMFService';
import transferConfig from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import {
  buildProcessSpeechUrl,
  createSayAttributes,
  createGatherAttributes,
  dialNumber,
  TwiMLDialAttributes,
  DEFAULT_SPEECH_TIMEOUT,
} from '../utils/twimlHelpers';
import { processVoiceInput } from './voiceProcessingService';

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
  // Test mode: skip TwiML generation and call history persistence
  testMode?: boolean;
}

export interface ProcessSpeechResult {
  twiml: string;
  shouldSend: boolean;
  // Structured results for eval service
  processingResult?: {
    isIVRMenu: boolean;
    menuOptions: MenuOption[];
    isMenuComplete: boolean;
    loopDetected: boolean;
    loopConfidence?: number;
    loopReason?: string;
    shouldTerminate: boolean;
    terminationReason?: string;
    transferRequested: boolean;
    transferConfidence?: number;
    transferReason?: string;
    dtmfDecision: DTMFDecision;
    shouldPreventDTMF: boolean;
  };
  aiResponse?: string;
  digitPressed?: string;
}

/**
 * Extract pure digits from an AI response (e.g., "90001", "720-584-6358" → "7205846358").
 * Returns the digit string if the response is digit-only, or null if it contains words.
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
 * Track how many times a digit has been pressed consecutively.
 */
function updateConsecutivePresses(
  callState: CallState,
  digitToPress: string
): { digit: string; count: number }[] {
  const existing = callState.consecutiveDTMFPresses || [];
  const last = existing[existing.length - 1];

  if (last && last.digit === digitToPress) {
    return [
      ...existing.slice(0, -1),
      { digit: digitToPress, count: last.count + 1 },
    ];
  }

  const updated = [...existing, { digit: digitToPress, count: 1 }];
  return updated.length > 5 ? updated.slice(-5) : updated;
}

/**
 * Process a speech turn end-to-end.
 * Used by both route handler (with TwiML) and eval service (test mode).
 */
export async function processSpeech({
  callSid,
  speechResult,
  isFirstCall,
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

    if (finalCustomInstructions) {
      callStateManager.updateCallState(callSid, {
        customInstructions: finalCustomInstructions,
      });
    }

    if (!callState.previousMenus) {
      callStateManager.updateCallState(callSid, { previousMenus: [] });
    }

    if (!testMode) {
      console.log('👤', speechResult);
    }

    // ── 2. Merge speech with any prior partial transcript (for menus, etc.) ──
    const previousSpeechForContext = callState.lastSpeech || '';
    let finalSpeech = speechResult;
    if (callState.awaitingCompleteSpeech && callState.lastSpeech) {
      finalSpeech = `${callState.lastSpeech} ${speechResult}`.trim();
    }

    callStateManager.updateCallState(callSid, {
      lastSpeech: finalSpeech,
      awaitingCompleteSpeech: false,
      incompleteSpeechWaitCount: 0,
    });

    if (!testMode) {
      callHistoryService
        .addConversation(callSid, 'user', finalSpeech)
        .catch(err => console.error('Error adding conversation:', err));
    }

    // ── 4. Fire off ALL AI calls in parallel to minimize latency ──────────
    // Instead of waiting for detection → then human check → then AI response
    // (8-13s total), we run them ALL at once (~3-5s total).
    const conversationHistory = callState.conversationHistory || [];
    const aiResponsePromise = aiService
      .generateResponse(
        config as TransferConfig,
        finalSpeech,
        isFirstCall,
        conversationHistory.map(h => ({ type: h.type, text: h.text || '' }))
      )
      .catch((err: Error) => {
        if (!testMode) console.error('❌ AI service error:', err.message);
        return 'silent';
      });

    const dataEntryModePromise = aiDetectionService
      .detectDataEntryInputMode(finalSpeech)
      .catch((err: Error) => {
        if (!testMode) {
          console.error('❌ Data entry mode detection error:', err.message);
        }
        return { mode: 'none', confidence: 0, reason: 'error' } as const;
      });

    const humanConfirmationPromise = callState.awaitingHumanConfirmation
      ? aiDetectionService.detectHumanConfirmation(finalSpeech)
      : Promise.resolve({ isHuman: false, confidence: 0 });

    const [result, precomputedAiResponse, humanConfirmation, dataEntryMode] =
      await Promise.all([
        processVoiceInput({
          speech: finalSpeech,
          previousSpeech: previousSpeechForContext,
          previousMenus: callState.previousMenus || [],
          partialMenuOptions: callState.partialMenuOptions,
          lastPressedDTMF: callState.lastPressedDTMF,
          lastMenuForDTMF: callState.lastMenuForDTMF,
          consecutiveDTMFPresses: callState.consecutiveDTMFPresses || [],
          config,
        }),
        aiResponsePromise,
        humanConfirmationPromise,
        dataEntryModePromise,
      ]);

    // ── 5. Termination ───────────────────────────────────────────────────────
    if (result.shouldTerminate) {
      if (!testMode) {
        console.log(
          `🛑 Call Terminated: ${result.terminationReason || 'unknown'}`
        );
        callHistoryService
          .addTermination(callSid, result.terminationReason || '')
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
      };
    }

    // ── 6. Transfer request ──────────────────────────────────────────────────
    if (result.transferRequested) {
      if (!testMode) {
        console.log(
          `🔄 Transfer detected (confidence: ${result.transferConfidence}): ${result.transferReason}`
        );
      }

      if (!callState.humanConfirmed) {
        callStateManager.updateCallState(callSid, {
          awaitingHumanConfirmation: true,
        });
        if (!testMode) {
          const sayAttributes = createSayAttributes(config);
          response.say(
            sayAttributes as Parameters<typeof response.say>[0],
            'Am I speaking with a real person or is this the automated system?'
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
        };
      }

      if (!testMode) {
        callHistoryService
          .addTransfer(callSid, config.transferNumber, true)
          .catch(err => console.error('Error adding transfer:', err));

        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          'Hold on, please.'
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
      };
    }

    // ── 7. IVR menu ──────────────────────────────────────────────────────────
    let shouldProcessAsMenu = result.isIVRMenu;
    if (!result.isIVRMenu && callState.awaitingCompleteMenu) {
      callStateManager.updateCallState(callSid, {
        awaitingCompleteMenu: false,
        partialMenuOptions: [],
      });
    } else if (callState.awaitingCompleteMenu) {
      shouldProcessAsMenu = true;
    }

    if (shouldProcessAsMenu) {
      const { menuOptions, isMenuComplete, dtmfDecision, shouldPreventDTMF } =
        result;

      if (!isMenuComplete) {
        const hasRealMatch =
          dtmfDecision.shouldPress &&
          dtmfDecision.digit &&
          dtmfDecision.matchType !== 'fallback';

        if (!hasRealMatch) {
          // No real match yet — accumulate options and wait for more speech
          callStateManager.updateCallState(callSid, {
            partialMenuOptions: menuOptions,
            awaitingCompleteMenu: true,
          });

          if (!testMode) {
            const menuSummary =
              menuOptions.length > 0
                ? `[IVR Menu incomplete - found: ${menuOptions.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`
                : '[IVR Menu detected but no options extracted yet. Waiting for complete menu...]';
            callHistoryService
              .addConversation(callSid, 'system', menuSummary)
              .catch(err => console.error('Error adding conversation:', err));
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
          };
        }
        // Menu incomplete but we have a real match — fall through to press DTMF
      }

      // Complete menu
      if (!testMode) {
        callHistoryService.addIVRMenu(callSid, menuOptions);
      }
      callStateManager.updateCallState(callSid, {
        lastMenuOptions: menuOptions,
        previousMenus: [...(callState.previousMenus || []), menuOptions],
        menuLevel: (callState.menuLevel || 0) + 1,
        partialMenuOptions: [],
        awaitingCompleteMenu: false,
      });

      // Loop prevention — don't press if we'd just be cycling
      if (shouldPreventDTMF) {
        if (!testMode && callState.lastPressedDTMF) {
          console.log(
            `⏸️  Loop detected, already pressed ${callState.lastPressedDTMF} for similar menu. Waiting...`
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
        };
      }

      if (dtmfDecision.shouldPress && dtmfDecision.digit) {
        const digit = dtmfDecision.digit;
        if (!testMode) {
          console.log(
            `🔢 Pressed DTMF: ${digit} - AI matched: ${dtmfDecision.matchedOption}`
          );
        }

        callStateManager.updateCallState(callSid, {
          lastPressedDTMF: digit,
          lastMenuForDTMF: menuOptions,
          consecutiveDTMFPresses: updateConsecutivePresses(callState, digit),
          lastSpeech: '',
          partialMenuOptions: [],
          awaitingCompleteMenu: false,
        });

        if (!testMode) {
          callHistoryService
            .addDTMF(
              callSid,
              digit,
              `AI selected: ${dtmfDecision.matchedOption}`
            )
            .catch(err => console.error('Error adding DTMF:', err));

          response.play({ digits: digit });
          response.redirect(
            `${baseUrl}/voice/process-dtmf?Digits=${digit}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`
          );
        }
        return {
          twiml: response.toString(),
          shouldSend: !testMode,
          processingResult: result,
          digitPressed: digit,
        };
      }

      // No matching option — wait silently
      if (!testMode) {
        callHistoryService
          .addConversation(
            callSid,
            'system',
            `[AI: No suitable option - ${dtmfDecision.reason}]`
          )
          .catch(err => console.error('Error adding conversation:', err));
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
      };
    }

    // ── 8. Human confirmation (after being asked "real person or automated?") ─
    const isHumanConfirmed =
      humanConfirmation.isHuman && humanConfirmation.confidence > 0.7;

    if (callState.awaitingHumanConfirmation && isHumanConfirmed) {
      callStateManager.updateCallState(callSid, {
        humanConfirmed: true,
        awaitingHumanConfirmation: false,
      });

      if (!testMode) {
        callHistoryService
          .addTransfer(callSid, config.transferNumber, true)
          .catch(err => console.error('Error adding transfer:', err));

        const sayAttributes = createSayAttributes(config);
        response.say(
          sayAttributes as Parameters<typeof response.say>[0],
          'Thank you. Hold on, please.'
        );
        response.pause({ length: 1 });
        const dial = response.dial({
          action: `${baseUrl}/voice/transfer-status`,
          method: 'POST',
          timeout: 30,
        });
        (dial as TwiMLDialAttributes).answerOnMedia = true;
        dialNumber(dial, config.transferNumber);
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
      };
    }

    // ── 9. AI conversational response (pre-computed in parallel) ───────────
    const skipAISpeaking = result.dtmfDecision?.shouldPress === true;
    const aiResponse = skipAISpeaking ? 'silent' : precomputedAiResponse;

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

    callStateManager.addToHistory(callSid, { type: 'user', text: finalSpeech });

    if (
      aiResponse &&
      aiResponse.trim().toLowerCase() !== 'silent' &&
      aiResponse.trim().length > 0
    ) {
      const dtmfDigits = extractDTMFDigits(aiResponse.trim());

      if (dtmfDigits && !testMode) {
        const mode = dataEntryMode.mode;

        if (mode === 'speech') {
          // System asked to SAY the number (ASR), not keypad entry.
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
          // Default to DTMF when allowed/expected.
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

        const gatherAttributes = createGatherAttributes(config, {
          action: buildProcessSpeechUrl({ baseUrl, config }),
          method: 'POST',
          enhanced: true,
          timeout: DEFAULT_SPEECH_TIMEOUT,
        });
        response.gather(
          gatherAttributes as Parameters<typeof response.gather>[0]
        );

        return {
          twiml: response.toString(),
          shouldSend: true,
          processingResult: result,
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
      const gatherAttributes = createGatherAttributes(config, {
        action: `${baseUrl}/voice/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
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
