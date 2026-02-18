/**
 * Voice Routes - Transfer-Only Mode
 * Handles Twilio voice webhooks for transfer-only phone navigation
 */

import express, { Request, Response } from 'express';
import twilio from 'twilio';
import { TwilioGatherInput, TwilioSayAttributes } from '../types/twilio-twiml';
import { TwilioCallStatus, isCallEnded } from '../types/callStatus';
import transferConfig from '../config/transfer-config';
import callStateManager from '../services/callStateManager';
import callHistoryService from '../services/callHistoryService';
import aiService from '../services/aiService';
import aiDTMFService from '../services/aiDTMFService';
import aiDetectionService from '../services/aiDetectionService';
import twilioService from '../services/twilioService';
import { TransferConfig } from '../services/aiService';
import { TransferConfig as TransferConfigType } from '../config/transfer-config';
import { toError } from '../utils/errorUtils';

const router = express.Router();

// Constants
/**
 * Default timeout for Twilio Gather speech input (in seconds)
 * This is the maximum time to wait for speech to START, not recording duration.
 * Once speech starts, Twilio records until there's a 2-second pause (speechTimeout: 'auto').
 * Increased to 15 seconds to capture longer IVR menus.
 */
const DEFAULT_SPEECH_TIMEOUT = 15;

// Type definitions for function parameters
interface BuildProcessSpeechUrlParams {
  baseUrl: string;
  config: TransferConfigType;
  additionalParams?: Record<string, string>;
}

interface AskForHumanConfirmationParams {
  response: twilio.twiml.VoiceResponse;
  baseUrl: string;
  config: TransferConfigType;
  callSid: string;
}

interface InitiateTransferParams {
  response: twilio.twiml.VoiceResponse;
  baseUrl: string;
  config: TransferConfigType;
  callSid: string;
  message?: string;
}

// Helper function to build process-speech action URL with all parameters
function buildProcessSpeechUrl({
  baseUrl,
  config,
  additionalParams = {},
}: BuildProcessSpeechUrlParams): string {
  const params = new URLSearchParams();
  params.append('transferNumber', config.transferNumber);
  if (config.callPurpose) {
    params.append('callPurpose', config.callPurpose);
  }
  if (config.customInstructions) {
    params.append('customInstructions', config.customInstructions);
  }
  // Add any additional params
  Object.entries(additionalParams).forEach(([key, value]) => {
    params.append(key, value);
  });
  return `${baseUrl}/voice/process-speech?${params.toString()}`;
}

/**
 * Ask for human confirmation before transferring
 * Sets up TwiML to ask if we're speaking with a real person
 * @param response - Twilio VoiceResponse instance
 * @param baseUrl - Base URL for callback
 * @param config - Transfer configuration
 * @param callSid - Call SID for state management
 * @returns The response object (for chaining)
 */
function askForHumanConfirmation({
  response,
  baseUrl,
  config,
  callSid,
}: AskForHumanConfirmationParams): twilio.twiml.VoiceResponse {
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
  response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

  return response;
}

/**
 * Create TwiML response for transferring call to a number
 * Encapsulates all transfer logic: logging, history, TwiML dial setup
 * @param response - Twilio VoiceResponse instance
 * @param baseUrl - Base URL for status callback
 * @param config - Transfer configuration containing transferNumber and voice settings
 * @param callSid - Call SID for logging and history
 * @param message - Optional message to say before transferring (default: 'Hold on, please.')
 * @returns The response object (for chaining)
 */
function initiateTransfer({
  response,
  baseUrl,
  config,
  callSid,
  message = 'Hold on, please.',
}: InitiateTransferParams): twilio.twiml.VoiceResponse {

  callHistoryService
    .addTransfer(callSid, config.transferNumber, true)
    .catch(err => console.error('Error adding transfer:', err));

  const sayAttributes = createSayAttributes(config);
  response.say(sayAttributes as Parameters<typeof response.say>[0], message);
  response.pause({ length: 1 });

  const dial = response.dial({
    action: `${baseUrl}/voice/transfer-status`,
    method: 'POST',
    timeout: 30,
  });
  (dial as TwiMLDialAttributes).answerOnMedia = true;
  dialNumber(dial, config.transferNumber);

  return response;
}

// Helper functions for properly typed Twilio TwiML calls
function createGatherAttributes(
  config: TransferConfigType,
  overrides: Partial<TwilioGatherInput> = {}
): TwilioGatherInput {
  return {
    input: ['speech'],
    language: config.aiSettings.language || 'en-US',
    // Use 'auto' to wait for natural speech pauses, but ensure we capture everything
    // 'auto' waits up to 2 seconds of silence before finalizing
    speechTimeout: 'auto',
    timeout: DEFAULT_SPEECH_TIMEOUT,
    ...overrides,
  };
}

function createSayAttributes(
  config: TransferConfigType,
  overrides: Partial<TwilioSayAttributes> = {}
): TwilioSayAttributes {
  return {
    voice: config.aiSettings.voice || 'Polly.Matthew',
    language: config.aiSettings.language || 'en-US',
    ...overrides,
  };
}

// Type definitions for Twilio TwiML properties that aren't fully typed
interface TwiMLDialAttributes {
  answerOnMedia?: boolean;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Helper function to dial a phone number (verb naming convention)
 * @param dial - Twilio Dial instance
 * @param phoneNumber - Phone number to dial
 */
function dialNumber(
  dial: ReturnType<twilio.twiml.VoiceResponse['dial']>,
  phoneNumber: string
): void {
  dial.number(phoneNumber);
}

/**
 * Get base URL from request
 */
function getBaseUrl(req: Request): string {
  const protocol = req.protocol || 'https';
  const host = req.get('host') || req.hostname;
  return `${protocol}://${host}`;
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
    const response = new twilio.twiml.VoiceResponse();

    try {
      const callSid = req.body.CallSid;
      const speechResult = req.body.SpeechResult || '';
      const isFirstCall = req.query.firstCall === 'true';

      const baseUrl = getBaseUrl(req);
      const callState = callStateManager.getCallState(callSid);
      // Use stored customInstructions from call state if available, otherwise from query params
      const customInstructionsFromState = callState.customInstructions;
      const customInstructionsFromQuery = req.query.customInstructions as
        | string
        | undefined;
      const finalCustomInstructions =
        customInstructionsFromQuery || customInstructionsFromState || '';

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
        customInstructions: finalCustomInstructions,
      });
      // Store customInstructions in call state for persistence
      if (finalCustomInstructions) {
        callStateManager.updateCallState(callSid, {
          customInstructions: finalCustomInstructions,
        });
      }
      // Log received speech
      console.log('👤', speechResult);

      if (!callSid) {
        throw new Error('Call SID is missing');
      }

      // callState already retrieved above for config creation
      // Initialize previousMenus if not present (for AI loop detection)
      if (!callState.previousMenus) {
        callStateManager.updateCallState(callSid, {
          previousMenus: [],
        });
      }

      // If we were awaiting complete speech, merge with previous partial speech
      // Note: We don't set awaitingCompleteSpeech: false here because we need to
      // check if the merged speech is still incomplete (it might need more segments)
      let finalSpeech = speechResult;
      if (callState.awaitingCompleteSpeech && callState.lastSpeech) {
        // Merge: combine previous partial speech with new speech
        finalSpeech = `${callState.lastSpeech} ${speechResult}`.trim();
        // Don't set awaitingCompleteSpeech: false yet - let the incomplete check below determine if we need more
      }

      const previousSpeech = callState.lastSpeech || '';
      // Use AI-powered termination detection with finalSpeech
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
        res.type('text/xml');
        res.send(response.toString());
        return;
      }

      // Check if speech is incomplete before processing
      // But first check if we've already waited too many times or if this is an IVR menu
      const incompleteSpeechWaitCount =
        callState.incompleteSpeechWaitCount || 0;
      const maxIncompleteWaits = 2; // Maximum number of times to wait for incomplete speech

      // Check if this is an IVR menu - if so, don't mark as incomplete
      const incompleteCheckMenuDetection =
        await aiDetectionService.detectIVRMenu(finalSpeech);
      const isIncompleteCheckIVRMenu = incompleteCheckMenuDetection.isIVRMenu;

      // Only check for incomplete speech if:
      // 1. We haven't waited too many times already
      // 2. This doesn't appear to be an IVR menu (IVR menus can be complete even if more options follow)
      // 3. The speech isn't extremely long (already merged multiple times)
      const shouldCheckIncomplete =
        incompleteSpeechWaitCount < maxIncompleteWaits &&
        !isIncompleteCheckIVRMenu &&
        finalSpeech.length < 500; // Prevent extremely long merged texts

      if (shouldCheckIncomplete) {
        const incompleteCheck =
          await aiDetectionService.detectIncompleteSpeech(finalSpeech);
        if (incompleteCheck.isIncomplete && incompleteCheck.confidence > 0.7) {

          // Store partial speech and wait for more
          callStateManager.updateCallState(callSid, {
            lastSpeech: finalSpeech,
            awaitingCompleteSpeech: true,
            incompleteSpeechWaitCount: incompleteSpeechWaitCount + 1,
          });

          // Set up gather to wait silently for more speech (don't speak, just listen)
          const gatherAttributes = createGatherAttributes(config, {
            action: buildProcessSpeechUrl({ baseUrl, config }),
            method: 'POST',
            enhanced: true,
            timeout: DEFAULT_SPEECH_TIMEOUT,
          });
          response.gather(
            gatherAttributes as Parameters<typeof response.gather>[0]
          );

          res.type('text/xml');
          res.send(response.toString());
          return;
        }
      }

      // Use finalSpeech (merged if needed) for all subsequent processing
      // Reset incomplete speech wait count when we process speech
      callStateManager.updateCallState(callSid, {
        lastSpeech: finalSpeech,
        awaitingCompleteSpeech: false,
        incompleteSpeechWaitCount: 0, // Reset when processing
      });
      callHistoryService
        .addConversation(callSid, 'user', finalSpeech)
        .catch(err => console.error('Error adding conversation:', err));

      // Check for transfer requests FIRST (before IVR menu processing)
      // Use AI-powered transfer detection with finalSpeech
      const transferDetection =
        await aiDetectionService.detectTransferRequest(finalSpeech);
      if (transferDetection.wantsTransfer) {

        const needsConfirmation = !callState.humanConfirmed;
        if (needsConfirmation) {
          askForHumanConfirmation({ response, baseUrl, config, callSid });
          res.type('text/xml');
          res.send(response.toString());
          return;
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
        (dial as TwiMLDialAttributes).answerOnMedia = true;
        dial.number(config.transferNumber);

        res.type('text/xml');
        res.send(response.toString());
        return;
      }

      if (callState.awaitingCompleteMenu) {
        // Use AI to detect if speech continues menu
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

      // Use AI-powered IVR menu detection
      const menuDetection = await aiDetectionService.detectIVRMenu(finalSpeech);
      const isIVRMenu = menuDetection.isIVRMenu;

      if (isIVRMenu || callState.awaitingCompleteMenu) {
        // Use AI-powered menu extraction
        const extractionResult =
          await aiDetectionService.extractMenuOptions(finalSpeech);
        const menuOptions = extractionResult.menuOptions;

        const isIncomplete = !extractionResult.isComplete;

        if (isIncomplete) {
          // Even if menu appears incomplete, use AI to check if we have a good match
          // Custom instructions take priority, otherwise check if option matches "speak with a representative"
          if (menuOptions.length > 0) {
            try {
              // Merge with any previous partial options for context
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

                // Track that we pressed this DTMF for this menu
                callStateManager.updateCallState(callSid, {
                  lastPressedDTMF: digitToPress,
                  lastMenuForDTMF: allMenuOptions,
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
                res.type('text/xml');
                res.send(response.toString());
                return;
              }
            } catch (error: unknown) {
              const err = error as Error;
              console.error(
                '❌ Error checking incomplete menu with AI:',
                err.message
              );
              // Fall through to waiting for more options
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
          res.type('text/xml');
          res.send(response.toString());
          return;
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

        // Use AI-powered loop detection (semantic matching)
        const previousMenus = callState.previousMenus || [];
        const loopCheck = await aiDetectionService.detectLoop(
          allMenuOptions,
          previousMenus
        );
        if (loopCheck.isLoop && loopCheck.confidence > 0.7) {

          // Check if we already pressed a DTMF for this same menu
          const lastMenuForDTMF = callState.lastMenuForDTMF || [];
          const menusMatch =
            lastMenuForDTMF.length === allMenuOptions.length &&
            lastMenuForDTMF.every(
              (opt, idx) =>
                opt.digit === allMenuOptions[idx]?.digit &&
                opt.option === allMenuOptions[idx]?.option
            );

          if (menusMatch && callState.lastPressedDTMF) {
            // Don't press again - wait for the system to respond
            // Continue with normal flow to gather more speech
          } else {
            // Use AI DTMF service to select best option when loop detected
            const aiDecision =
              await aiDTMFService.understandCallPurposeAndPressDTMF(
                speechResult,
                { callPurpose: config.callPurpose },
                allMenuOptions
              );

            const bestOption =
              aiDecision.shouldPress && aiDecision.digit
                ? allMenuOptions.find(
                    (opt: { digit: string; option: string }) =>
                      opt.digit === aiDecision.digit
                  )
                : allMenuOptions.find(
                    (opt: { digit: string; option: string }) =>
                      opt.option.includes('representative') ||
                      opt.option.includes('agent') ||
                      opt.option.includes('other') ||
                      opt.option.includes('operator')
                  ) || allMenuOptions[0];

            if (bestOption) {
              const digitToPress = bestOption.digit;
              console.log(
                `🔢 Pressed DTMF: ${digitToPress} - Loop detected`
              );

              // Track that we pressed this DTMF for this menu
              callStateManager.updateCallState(callSid, {
                lastPressedDTMF: digitToPress,
                lastMenuForDTMF: allMenuOptions,
              });

              callHistoryService
                .addDTMF(callSid, digitToPress, 'Loop detected - immediate press')
                .catch(err => console.error('Error adding DTMF:', err));

              response.pause({ length: 0.5 });
              setTimeout(async () => {
                await twilioService.sendDTMF(callSid, digitToPress);
              }, 500);
              response.redirect(
                `${baseUrl}/voice/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`
              );
              res.type('text/xml');
              res.send(response.toString());
              return;
            }
          }
        }

        // Track previous menus for AI loop detection
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

        // Use AI DTMF decision - no static fallback, rely entirely on AI
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

          // Track that we pressed this DTMF for this menu
          callStateManager.updateCallState(callSid, {
            lastPressedDTMF: digitToPress,
            lastMenuForDTMF: allMenuOptions,
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
          res.type('text/xml');
          res.send(response.toString());
          return;
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
          res.type('text/xml');
          res.send(response.toString());
          return;
        }
      }

      // Use AI-powered human confirmation detection
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

          initiateTransfer({
            response,
            baseUrl,
            config,
            callSid,
            message: 'Thank you. Hold on, please.',
          });

          res.type('text/xml');
          res.send(response.toString());
          return;
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
        res.type('text/xml');
        res.send(response.toString());
        return;
      }

      const conversationHistory = callState.conversationHistory || [];

      let aiResponse: string;
      try {
        // Add timeout to prevent hanging
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
        // Log OpenAI response
        if (aiResponse && aiResponse.trim().toLowerCase() !== 'silent' && aiResponse.trim().length > 0) {
          console.log('🤖', aiResponse);
        }
      } catch (error: unknown) {
        const err = toError(error);
        console.error('❌ AI service error:', err.message);
        // Fallback: remain silent on AI error
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

      res.type('text/xml');
      res.send(response.toString());
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

  // Store customInstructions in call state for persistence
  if (finalCustomInstructions) {
    callStateManager.updateCallState(callSid, {
      customInstructions: finalCustomInstructions,
    });
  }

  // Log DTMF press
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
