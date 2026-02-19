/**
 * Speech Processing Service
 * Handles all speech processing logic - consolidates logic from route handler and evaluation tests
 */

import twilio from 'twilio';
import callStateManager from './callStateManager';
import callHistoryService from './callHistoryService';
import aiService, { TransferConfig } from './aiService';
import aiDetectionService from './aiDetectionService';
import aiDTMFService from './aiDTMFService';
import twilioService from './twilioService';
import transferConfig from '../config/transfer-config';
import {
  buildProcessSpeechUrl,
  createSayAttributes,
  createGatherAttributes,
  dialNumber,
  TwiMLDialAttributes,
} from '../utils/twimlHelpers';

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
}

export interface ProcessSpeechResult {
  twiml: string;
  shouldSend: boolean;
}

/**
 * Process speech input and return TwiML response
 * This consolidates all speech processing logic from the route handler
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
}: ProcessSpeechParams): Promise<ProcessSpeechResult> {
  const response = new twilio.twiml.VoiceResponse();

  try {
    const callState = callStateManager.getCallState(callSid);
    const customInstructionsFromState = callState.customInstructions;
    const finalCustomInstructions =
      customInstructions || customInstructionsFromState || '';

    const config = transferConfig.createConfig({
      transferNumber: transferNumber || process.env.TRANSFER_PHONE_NUMBER,
      userPhone: userPhone || process.env.USER_PHONE_NUMBER,
      userEmail: userEmail || process.env.USER_EMAIL,
      callPurpose:
        callPurpose ||
        process.env.CALL_PURPOSE ||
        'speak with a representative',
      customInstructions: finalCustomInstructions,
    });

    if (finalCustomInstructions) {
      callStateManager.updateCallState(callSid, {
        customInstructions: finalCustomInstructions,
      });
    }

    console.log('👤', speechResult);

    if (!callSid) {
      throw new Error('Call SID is missing');
    }

    if (!callState.previousMenus) {
      callStateManager.updateCallState(callSid, {
        previousMenus: [],
      });
    }

    let finalSpeech = speechResult;
    if (callState.awaitingCompleteSpeech && callState.lastSpeech) {
      finalSpeech = `${callState.lastSpeech} ${speechResult}`.trim();
    }

    const previousSpeech = callState.lastSpeech || '';
    const termination = await aiDetectionService.detectTermination(
      finalSpeech,
      previousSpeech,
      0
    );
    if (termination.shouldTerminate) {
      callHistoryService
        .addTermination(
          callSid,
          termination.reason || termination.message || ''
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
      return { twiml: response.toString(), shouldSend: true };
    }

    const incompleteSpeechWaitCount =
      callState.incompleteSpeechWaitCount || 0;
    const maxIncompleteWaits = 2;

    const incompleteCheckMenuDetection =
      await aiDetectionService.detectIVRMenu(finalSpeech);
    const isIncompleteCheckIVRMenu = incompleteCheckMenuDetection.isIVRMenu;

    const shouldCheckIncomplete =
      incompleteSpeechWaitCount < maxIncompleteWaits &&
      !isIncompleteCheckIVRMenu &&
      finalSpeech.length < 500;

    if (shouldCheckIncomplete) {
      const incompleteCheck =
        await aiDetectionService.detectIncompleteSpeech(finalSpeech);
      if (incompleteCheck.isIncomplete && incompleteCheck.confidence > 0.7) {
        callStateManager.updateCallState(callSid, {
          lastSpeech: finalSpeech,
          awaitingCompleteSpeech: true,
          incompleteSpeechWaitCount: incompleteSpeechWaitCount + 1,
        });

        const gatherAttributes = createGatherAttributes(config, {
          action: buildProcessSpeechUrl({ baseUrl, config }),
          method: 'POST',
          enhanced: true,
          timeout: DEFAULT_SPEECH_TIMEOUT,
        });
        response.gather(
          gatherAttributes as Parameters<typeof response.gather>[0]
        );
        return { twiml: response.toString(), shouldSend: true };
      }
    }

    callStateManager.updateCallState(callSid, {
      lastSpeech: finalSpeech,
      awaitingCompleteSpeech: false,
      incompleteSpeechWaitCount: 0,
    });
    callHistoryService
      .addConversation(callSid, 'user', finalSpeech)
      .catch(err => console.error('Error adding conversation:', err));

    const transferDetection =
      await aiDetectionService.detectTransferRequest(finalSpeech);
    if (transferDetection.wantsTransfer) {
      console.log(
        `🔄 Transfer detected (confidence: ${transferDetection.confidence}): ${transferDetection.reason}`
      );

      const needsConfirmation = !callState.humanConfirmed;
      if (needsConfirmation) {
        callStateManager.updateCallState(callSid, {
          awaitingHumanConfirmation: true,
        });

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
        return { twiml: response.toString(), shouldSend: true };
      }

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

      return { twiml: response.toString(), shouldSend: true };
    }

    if (callState.awaitingCompleteMenu) {
      const menuDetection =
        await aiDetectionService.detectIVRMenu(finalSpeech);
      const isContinuingMenu = menuDetection.isIVRMenu;

      if (!isContinuingMenu) {
        callStateManager.updateCallState(callSid, {
          awaitingCompleteMenu: false,
          partialMenuOptions: [],
        });
      }
    }

    const menuDetection = await aiDetectionService.detectIVRMenu(finalSpeech);
    const isIVRMenu = menuDetection.isIVRMenu;

    if (isIVRMenu || callState.awaitingCompleteMenu) {
      const extractionResult =
        await aiDetectionService.extractMenuOptions(finalSpeech);
      const menuOptions = extractionResult.menuOptions;
      const isIncomplete = !extractionResult.isComplete;

      if (isIncomplete) {
        if (menuOptions.length > 0) {
          try {
            let allMenuOptions = menuOptions;
            if (
              callState.partialMenuOptions &&
              callState.partialMenuOptions.length > 0
            ) {
              allMenuOptions = [
                ...callState.partialMenuOptions,
                ...menuOptions,
              ];
              const seen = new Set<string>();
              allMenuOptions = allMenuOptions.filter(
                (opt: { digit: string; option: string }) => {
                  const key = `${opt.digit}-${opt.option}`;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                }
              );
            }

            const aiDecision =
              await aiDTMFService.understandCallPurposeAndPressDTMF(
                finalSpeech,
                {
                  callPurpose: config.callPurpose,
                  customInstructions: config.customInstructions,
                },
                allMenuOptions
              );

            if (aiDecision.shouldPress && aiDecision.digit) {
              const matchedOption = allMenuOptions.find(
                (opt: { digit: string; option: string }) =>
                  opt.digit === aiDecision.digit
              );

              callStateManager.updateCallState(callSid, {
                partialMenuOptions: [],
                awaitingCompleteMenu: false,
                lastMenuOptions: allMenuOptions,
                menuLevel: (callState.menuLevel || 0) + 1,
              });
              callHistoryService.addIVRMenu(callSid, allMenuOptions);

              const digitToPress = aiDecision.digit;
              console.log(
                `🔢 Pressed DTMF: ${digitToPress} - AI matched: ${matchedOption?.option || aiDecision.matchedOption}`
              );

              const consecutivePresses = callState.consecutiveDTMFPresses || [];
              const lastPress = consecutivePresses[consecutivePresses.length - 1];
              let updatedConsecutivePresses: { digit: string; count: number }[];

              if (lastPress && lastPress.digit === digitToPress) {
                updatedConsecutivePresses = [
                  ...consecutivePresses.slice(0, -1),
                  { digit: digitToPress, count: lastPress.count + 1 },
                ];
              } else {
                updatedConsecutivePresses = [
                  ...consecutivePresses,
                  { digit: digitToPress, count: 1 },
                ];
                if (updatedConsecutivePresses.length > 5) {
                  updatedConsecutivePresses = updatedConsecutivePresses.slice(-5);
                }
              }

              callStateManager.updateCallState(callSid, {
                lastPressedDTMF: digitToPress,
                lastMenuForDTMF: allMenuOptions,
                consecutiveDTMFPresses: updatedConsecutivePresses,
              });

              callHistoryService
                .addDTMF(
                  callSid,
                  digitToPress,
                  `AI matched: ${aiDecision.matchedOption || matchedOption?.option}`
                )
                .catch(err => console.error('Error adding DTMF:', err));

              response.pause({ length: 2 });
              setTimeout(async () => {
                await twilioService.sendDTMF(callSid, digitToPress);
              }, 2000);
              response.redirect(
                `${baseUrl}/voice/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}&customInstructions=${encodeURIComponent(config.customInstructions || '')}`
              );
              return { twiml: response.toString(), shouldSend: true };
            }
          } catch (error: unknown) {
            const err = error as Error;
            console.error(
              '❌ Error checking incomplete menu with AI:',
              err.message
            );
          }
        }

        callStateManager.updateCallState(callSid, {
          partialMenuOptions: menuOptions,
          awaitingCompleteMenu: true,
        });

        const menuSummary =
          menuOptions.length > 0
            ? `[IVR Menu incomplete - found: ${menuOptions.map((o: { digit: string; option: string }) => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`
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
        return { twiml: response.toString(), shouldSend: true };
      }

      let allMenuOptions = menuOptions;
      if (
        callState.partialMenuOptions &&
        callState.partialMenuOptions.length > 0
      ) {
        allMenuOptions = [...callState.partialMenuOptions, ...menuOptions];
        const seen = new Set<string>();
        allMenuOptions = allMenuOptions.filter(
          (opt: { digit: string; option: string }) => {
            const key = `${opt.digit}-${opt.option}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }
        );
        callStateManager.updateCallState(callSid, {
          partialMenuOptions: [],
          awaitingCompleteMenu: false,
        });
      }

      callHistoryService.addIVRMenu(callSid, allMenuOptions);

      const previousMenus = callState.previousMenus || [];
      const loopCheck = await aiDetectionService.detectLoop(
        allMenuOptions,
        previousMenus
      );
      if (loopCheck.isLoop && loopCheck.confidence > 0.7) {
        console.log(
          `🔄 Loop detected (confidence: ${loopCheck.confidence}): ${loopCheck.reason}`
        );

        if (callState.lastPressedDTMF) {
          console.log(
            `⏸️  Loop detected, already pressed ${callState.lastPressedDTMF} for similar menu. Waiting for system response instead of pressing again...`
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
          return { twiml: response.toString(), shouldSend: true };
        }

        const consecutivePresses = callState.consecutiveDTMFPresses || [];
        if (consecutivePresses.length > 0) {
          const lastPress = consecutivePresses[consecutivePresses.length - 1];
          if (lastPress.count >= 3) {
            console.log(
              `⏸️  Same digit (${lastPress.digit}) pressed ${lastPress.count} times consecutively. Waiting for system response...`
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
            return { twiml: response.toString(), shouldSend: true };
          }
        }
      }

      const updatedPreviousMenus = [...previousMenus, allMenuOptions];
      callStateManager.updateCallState(callSid, {
        lastMenuOptions: allMenuOptions,
        previousMenus: updatedPreviousMenus,
        menuLevel: (callState.menuLevel || 0) + 1,
      });

      const aiDecision =
        await aiDTMFService.understandCallPurposeAndPressDTMF(
          speechResult,
          {
            callPurpose: config.callPurpose,
            customInstructions: config.customInstructions,
          },
          allMenuOptions
        );

      let digitToPress: string | null = null;
      if (aiDecision.shouldPress && aiDecision.digit) {
        digitToPress = aiDecision.digit;
        console.log(
          `🔢 Pressed DTMF: ${digitToPress} - AI matched: ${aiDecision.matchedOption}`
        );
      } else {
        callHistoryService
          .addConversation(
            callSid,
            'system',
            `[AI: No suitable option - ${aiDecision.reason}]`
          )
          .catch(err => console.error('Error adding conversation:', err));
      }

      if (digitToPress) {
        const reason =
          aiDecision && aiDecision.matchedOption
            ? `AI selected: ${aiDecision.matchedOption}`
            : 'Selected best option';

        const consecutivePresses = callState.consecutiveDTMFPresses || [];
        const lastPress = consecutivePresses[consecutivePresses.length - 1];
        let updatedConsecutivePresses: { digit: string; count: number }[];

        if (lastPress && lastPress.digit === digitToPress) {
          updatedConsecutivePresses = [
            ...consecutivePresses.slice(0, -1),
            { digit: digitToPress, count: lastPress.count + 1 },
          ];
        } else {
          updatedConsecutivePresses = [
            ...consecutivePresses,
            { digit: digitToPress, count: 1 },
          ];
          if (updatedConsecutivePresses.length > 5) {
            updatedConsecutivePresses = updatedConsecutivePresses.slice(-5);
          }
        }

        callStateManager.updateCallState(callSid, {
          lastPressedDTMF: digitToPress,
          lastMenuForDTMF: allMenuOptions,
          consecutiveDTMFPresses: updatedConsecutivePresses,
        });

        callHistoryService
          .addDTMF(callSid, digitToPress, reason)
          .catch(err => console.error('Error adding DTMF:', err));

        response.pause({ length: 2 });
        setTimeout(async () => {
          await twilioService.sendDTMF(callSid, digitToPress!);
        }, 2000);
        response.redirect(
          `${baseUrl}/voice/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`
        );
        return { twiml: response.toString(), shouldSend: true };
      } else {
        callHistoryService
          .addConversation(
            callSid,
            'system',
            '[No matching option found - waiting silently]'
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
        return { twiml: response.toString(), shouldSend: true };
      }
    }

    const humanConfirmation =
      await aiDetectionService.detectHumanConfirmation(finalSpeech);
    const isHumanConfirmation =
      humanConfirmation.isHuman && humanConfirmation.confidence > 0.7;

    if (callState.awaitingHumanConfirmation || isHumanConfirmation) {
      if (isHumanConfirmation) {
        callStateManager.updateCallState(callSid, {
          humanConfirmed: true,
          awaitingHumanConfirmation: false,
        });

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

        return { twiml: response.toString(), shouldSend: true };
      }
    }

    if (callState.awaitingCompleteMenu) {
      callHistoryService
        .addConversation(
          callSid,
          'system',
          '[Waiting for complete menu - remaining silent]'
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
      return { twiml: response.toString(), shouldSend: true };
    }

    const conversationHistory = callState.conversationHistory || [];

    let aiResponse: string;
    try {
      const aiPromise = aiService.generateResponse(
        config as TransferConfig,
        finalSpeech,
        isFirstCall,
        conversationHistory.map(h => ({ type: h.type, text: h.text || '' }))
      );

      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `AI service timeout after ${DEFAULT_SPEECH_TIMEOUT} seconds`
              )
            ),
          DEFAULT_SPEECH_TIMEOUT * 1000
        );
      });

      aiResponse = await Promise.race([aiPromise, timeoutPromise]);

      if (
        aiResponse &&
        aiResponse.trim().toLowerCase() !== 'silent' &&
        aiResponse.trim().length > 0
      ) {
        console.log('🤖', aiResponse);
      } else if (
        !aiResponse ||
        aiResponse.trim().toLowerCase() === 'silent'
      ) {
        console.log('🤖 Silent (no response generated)');
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error('❌ AI service error:', err.message);
      aiResponse = 'silent';
    }

    callStateManager.addToHistory(callSid, {
      type: 'system',
      text: speechResult,
    });

    if (
      aiResponse &&
      aiResponse.trim().toLowerCase() !== 'silent' &&
      aiResponse.trim().length > 0
    ) {
      callStateManager.addToHistory(callSid, {
        type: 'ai',
        text: aiResponse,
      });

      callHistoryService
        .addConversation(callSid, 'ai', aiResponse)
        .catch(err => console.error('Error adding conversation:', err));

      const sayAttributes = createSayAttributes(config);
      response.say(
        sayAttributes as Parameters<typeof response.say>[0],
        aiResponse
      );
    }

    const gatherAttributes = createGatherAttributes(config, {
      action: `${baseUrl}/voice/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
      method: 'POST',
      enhanced: true,
      timeout: DEFAULT_SPEECH_TIMEOUT,
    });
    response.gather(
      gatherAttributes as Parameters<typeof response.gather>[0]
    );

    return { twiml: response.toString(), shouldSend: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error('❌ Error in processSpeech:', errorMessage);

    const errorResponse = new twilio.twiml.VoiceResponse();
    errorResponse.say(
      { voice: 'alice', language: 'en-US' },
      'I apologize, but an application error has occurred. Please try again later.'
    );
    errorResponse.hangup();
    return { twiml: errorResponse.toString(), shouldSend: true };
  }
}

