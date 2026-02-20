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
import twilioService from './twilioService';
import transferConfig from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import {
  buildProcessSpeechUrl,
  createSayAttributes,
  createGatherAttributes,
  dialNumber,
  TwiMLDialAttributes,
} from '../utils/twimlHelpers';
import { processVoiceInput } from './voiceProcessingService';

const DEFAULT_SPEECH_TIMEOUT = 15;

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
 * Track how many times a digit has been pressed consecutively.
 */
function updateConsecutivePresses(
  callState: CallState,
  digitToPress: string
): { digit: string; count: number }[] {
  const existing = callState.consecutiveDTMFPresses || [];
  const last = existing[existing.length - 1];

  if (last && last.digit === digitToPress) {
    return [...existing.slice(0, -1), { digit: digitToPress, count: last.count + 1 }];
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
    // ── 1. State & config setup ──────────────────────────────────────────────
    const callState = callStateManager.getCallState(callSid);
    const finalCustomInstructions =
      customInstructions || callState.customInstructions || '';

    const config = transferConfig.createConfig({
      transferNumber: transferNumber || process.env.TRANSFER_PHONE_NUMBER,
      userPhone: userPhone || process.env.USER_PHONE_NUMBER,
      userEmail: userEmail || process.env.USER_EMAIL,
      callPurpose:
        callPurpose || process.env.CALL_PURPOSE || 'speak with a representative',
      customInstructions: finalCustomInstructions,
    });

    if (finalCustomInstructions) {
      callStateManager.updateCallState(callSid, {
        customInstructions: finalCustomInstructions,
      });
    }

    if (!callSid) throw new Error('Call SID is missing');

    if (!callState.previousMenus) {
      callStateManager.updateCallState(callSid, { previousMenus: [] });
    }

    if (!testMode) {
      console.log('👤', speechResult);
    }

    // ── 2. Merge incomplete speech ───────────────────────────────────────────
    let finalSpeech = speechResult;
    if (callState.awaitingCompleteSpeech && callState.lastSpeech) {
      finalSpeech = `${callState.lastSpeech} ${speechResult}`.trim();
    }

    // ── 3. Incomplete-speech guard (fast path — avoids heavy AI calls) ───────
    const incompleteSpeechWaitCount = callState.incompleteSpeechWaitCount || 0;
    const maxIncompleteWaits = 2;

    if (incompleteSpeechWaitCount < maxIncompleteWaits && finalSpeech.length < 500) {
      const incompleteCheck =
        await aiDetectionService.detectIncompleteSpeech(finalSpeech);
      if (incompleteCheck.isIncomplete && incompleteCheck.confidence > 0.7) {
        callStateManager.updateCallState(callSid, {
          lastSpeech: finalSpeech,
          awaitingCompleteSpeech: true,
          incompleteSpeechWaitCount: incompleteSpeechWaitCount + 1,
        });
        if (!testMode) {
          const gatherAttributes = createGatherAttributes(config, {
            action: buildProcessSpeechUrl({ baseUrl, config }),
            method: 'POST',
            enhanced: true,
            timeout: DEFAULT_SPEECH_TIMEOUT,
          });
          response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
        }
        return {
          twiml: response.toString(),
          shouldSend: !testMode,
        };
      }
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

    // ── 4. Core AI decisions (using shared processVoiceInput function) ──
    const result = await processVoiceInput({
      speech: finalSpeech,
      previousSpeech: callState.lastSpeech || '',
      previousMenus: callState.previousMenus || [],
      partialMenuOptions: callState.partialMenuOptions,
      lastPressedDTMF: callState.lastPressedDTMF,
      lastMenuForDTMF: callState.lastMenuForDTMF,
      consecutiveDTMFPresses: callState.consecutiveDTMFPresses || [],
      config,
    });

    // ── 5. Termination ───────────────────────────────────────────────────────
    if (result.shouldTerminate) {
      if (!testMode) {
        console.log(`🛑 Call Terminated: ${result.terminationReason || 'unknown'}`);
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
          response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
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
      const { menuOptions, isMenuComplete, dtmfDecision, shouldPreventDTMF } = result;

      if (!isMenuComplete) {
        // Incomplete menu — try to press early if we have enough options
        if (menuOptions.length > 0 && dtmfDecision.shouldPress && dtmfDecision.digit) {
          const digit = dtmfDecision.digit;
          if (!testMode) {
            console.log(`🔢 Pressed DTMF: ${digit} - AI matched: ${dtmfDecision.matchedOption}`);
          }

          callStateManager.updateCallState(callSid, {
            partialMenuOptions: [],
            awaitingCompleteMenu: false,
            lastMenuOptions: menuOptions,
            menuLevel: (callState.menuLevel || 0) + 1,
            lastPressedDTMF: digit,
            lastMenuForDTMF: menuOptions,
            consecutiveDTMFPresses: updateConsecutivePresses(callState, digit),
          });

          if (!testMode) {
            callHistoryService.addIVRMenu(callSid, menuOptions);
            callHistoryService
              .addDTMF(callSid, digit, `AI matched: ${dtmfDecision.matchedOption}`)
              .catch(err => console.error('Error adding DTMF:', err));

            response.pause({ length: 2 });
            setTimeout(async () => {
              await twilioService.sendDTMF(callSid, digit);
            }, 2000);
            response.redirect(
              `${baseUrl}/voice/process-dtmf?Digits=${digit}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}&customInstructions=${encodeURIComponent(config.customInstructions || '')}`
            );
          }
          return {
            twiml: response.toString(),
            shouldSend: !testMode,
            processingResult: result,
            digitPressed: digit,
          };
        }

        // Accumulate and wait for the rest of the menu
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
          response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
        }
        return {
          twiml: response.toString(),
          shouldSend: !testMode,
          processingResult: result,
        };
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
          response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
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
          console.log(`🔢 Pressed DTMF: ${digit} - AI matched: ${dtmfDecision.matchedOption}`);
        }

        callStateManager.updateCallState(callSid, {
          lastPressedDTMF: digit,
          lastMenuForDTMF: menuOptions,
          consecutiveDTMFPresses: updateConsecutivePresses(callState, digit),
        });

        if (!testMode) {
          callHistoryService
            .addDTMF(callSid, digit, `AI selected: ${dtmfDecision.matchedOption}`)
            .catch(err => console.error('Error adding DTMF:', err));

          response.pause({ length: 2 });
          setTimeout(async () => {
            await twilioService.sendDTMF(callSid, digit);
          }, 2000);
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
        response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
      }
      return {
        twiml: response.toString(),
        shouldSend: !testMode,
        processingResult: result,
      };
    }

    // ── 8. Human confirmation (after being asked "real person or automated?") ─
    const humanConfirmation =
      await aiDetectionService.detectHumanConfirmation(finalSpeech);
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

    // ── 9. AI conversational response ────────────────────────────────────────
    const conversationHistory = callState.conversationHistory || [];
    let aiResponse: string;

    try {
      const aiPromise = aiService.generateResponse(
        config as TransferConfig,
        finalSpeech,
        isFirstCall,
        conversationHistory.map(h => ({ type: h.type, text: h.text || '' }))
      );
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `AI service timeout after ${DEFAULT_SPEECH_TIMEOUT} seconds`
              )
            ),
          DEFAULT_SPEECH_TIMEOUT * 1000
        )
      );
      aiResponse = await Promise.race([aiPromise, timeoutPromise]);

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
    } catch (error: unknown) {
      const err = error as Error;
      if (!testMode) {
        console.error('❌ AI service error:', err.message);
      }
      aiResponse = 'silent';
    }

    callStateManager.addToHistory(callSid, { type: 'system', text: speechResult });

    if (
      aiResponse &&
      aiResponse.trim().toLowerCase() !== 'silent' &&
      aiResponse.trim().length > 0
    ) {
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
      response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);
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
