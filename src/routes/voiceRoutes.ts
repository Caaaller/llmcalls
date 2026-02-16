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
import * as ivrDetector from '../utils/ivrDetector';
import * as transferDetector from '../utils/transferDetector';
import * as terminationDetector from '../utils/terminationDetector';
import { createLoopDetector } from '../utils/loopDetector';
import aiService from '../services/aiService';
import aiDTMFService from '../services/aiDTMFService';
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

// Helper function to build process-speech action URL with all parameters
function buildProcessSpeechUrl(
  baseUrl: string,
  config: TransferConfigType,
  additionalParams: Record<string, string> = {}
): string {
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
function askForHumanConfirmation(
  response: twilio.twiml.VoiceResponse,
  baseUrl: string,
  config: TransferConfigType,
  callSid: string
): twilio.twiml.VoiceResponse {
  console.log('❓ Asking: Am I speaking with a human?');
  callStateManager.updateCallState(callSid, {
    awaitingHumanConfirmation: true,
  });

  const sayAttributes = createSayAttributes(config);
  response.say(
    sayAttributes as Parameters<typeof response.say>[0],
    'Am I speaking with a real person or is this the automated system?'
  );
  const gatherAttributes = createGatherAttributes(config, {
    action: buildProcessSpeechUrl(baseUrl, config),
    method: 'POST',
    enhanced: true,
    timeout: DEFAULT_SPEECH_TIMEOUT,
  });
  response.gather(
    gatherAttributes as Parameters<typeof response.gather>[0]
  );

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
function initiateTransfer(
  response: twilio.twiml.VoiceResponse,
  baseUrl: string,
  config: TransferConfigType,
  callSid: string,
  message: string = 'Hold on, please.'
): twilio.twiml.VoiceResponse {
  console.log(`🔄 Initiating transfer to ${config.transferNumber}`);

  callHistoryService
    .addTransfer(callSid, config.transferNumber, true)
    .catch(err => console.error('Error adding transfer:', err));

  const sayAttributes = createSayAttributes(config);
  response.say(
    sayAttributes as Parameters<typeof response.say>[0],
    message
  );
  response.pause({ length: 1 });

  const dial = response.dial({
    action: `${baseUrl}/voice/transfer-status`,
    method: 'POST',
    timeout: 30,
  });
  (dial as TwiMLDialAttributes).answerOnMedia = true;
  dial.number(config.transferNumber);

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
    console.log('📞 /voice endpoint called');
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

    console.log('📞 Call received - Transfer-Only Mode');
    console.log('Call SID:', callSid);
    console.log('Transfer Number:', config.transferNumber);
    console.log('Call Purpose:', config.callPurpose);

    callStateManager.updateCallState(callSid, {
      transferConfig: config as TransferConfigType,
      loopDetector: createLoopDetector(),
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
      action: buildProcessSpeechUrl(baseUrl, config, { firstCall: 'true' }),
      method: 'POST',
      enhanced: true,
      timeout: DEFAULT_SPEECH_TIMEOUT,
    });
    console.log('🎤 Setting up initial gather - listening for speech...');
    console.log('  Timeout:', gatherAttributes.timeout, 'seconds');
    console.log('  SpeechTimeout:', gatherAttributes.speechTimeout);
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
    console.log('📥 /process-speech endpoint called');
    const response = new twilio.twiml.VoiceResponse();

    try {
      console.log('📥 Extracting request data...');
      const callSid = req.body.CallSid;
      const speechResult = req.body.SpeechResult || '';
      const isFirstCall = req.query.firstCall === 'true';

      console.log('📥 Getting base URL...');
      const baseUrl = getBaseUrl(req);
      console.log('📥 Base URL:', baseUrl);

      console.log('📥 Creating config...');
      const callState = callStateManager.getCallState(callSid);
      // Use stored customInstructions from call state if available, otherwise from query params
      const customInstructionsFromState = callState.customInstructions;
      const customInstructionsFromQuery = (req.query.customInstructions as string) || '';
      const finalCustomInstructions = customInstructionsFromQuery || customInstructionsFromState || '';
      
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
      console.log('📥 Config created');
      console.log('📥 Custom instructions:', config.customInstructions || '(none)');

      console.log('🎤 Received speech:', speechResult);
      console.log('  Speech length:', speechResult?.length || 0, 'characters');
      console.log('  Call SID:', callSid);
      console.log('  Is first call:', isFirstCall);

      if (!callSid) {
        throw new Error('Call SID is missing');
      }

      // callState already retrieved above for config creation
      if (!callState.loopDetector) {
        callStateManager.updateCallState(callSid, {
          loopDetector: createLoopDetector(),
        });
      }
      const loopDetector = callState.loopDetector!;

      const previousSpeech = callState.lastSpeech || '';
      const termination = terminationDetector.shouldTerminate(
        speechResult,
        previousSpeech,
        0
      );
      if (termination.shouldTerminate) {
        console.log(`🛑 ${termination.message}`);

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

      callStateManager.updateCallState(callSid, { lastSpeech: speechResult });
      callHistoryService
        .addConversation(callSid, 'user', speechResult)
        .catch(err => console.error('Error adding conversation:', err));

      // Check for human confirmation FIRST (before transfer detection)
      // If we're awaiting human confirmation, process that response immediately
      const isHumanConfirmation =
        /(?:yes|yeah|correct|right|real person|human|yes i am|yes this is|yes you are|talking to a real person|speaking with a real person|this is a real person|i am a real person|i'm a real person)/i.test(
          speechResult
        );

      if (callState.awaitingHumanConfirmation) {
        if (isHumanConfirmation) {
          console.log('✅ Human confirmed - transferring');
          callStateManager.updateCallState(callSid, {
            humanConfirmed: true,
            awaitingHumanConfirmation: false,
          });

          initiateTransfer(
            response,
            baseUrl,
            config,
            callSid,
            'Thank you. Hold on, please.'
          );

          res.type('text/xml');
          res.send(response.toString());
          return;
        } else {
          // Not a human confirmation, but we're still awaiting it
          // Ask again
          console.log('⚠️ Still awaiting human confirmation, but response was not a clear confirmation');
          askForHumanConfirmation(response, baseUrl, config, callSid);
          res.type('text/xml');
          res.send(response.toString());
          return;
        }
      }

      // Check for transfer requests (before IVR menu processing)
      // This ensures we catch transfer phrases even if they contain menu-like words
      if (transferDetector.wantsTransfer(speechResult)) {
        console.log('🔄 Potential transfer request detected');

        // If we're already awaiting human confirmation, the human confirmation check above handles it
        if (callState.awaitingHumanConfirmation) {
          // Already handled by human confirmation check above - continue with normal flow
        } else if (!callState.humanConfirmed) {
          // First, validate with AI that we are speaking with a real human (not automated system)
          let isRealHuman = false;
          
          try {
            console.log('🤖 Validating with AI: Are we speaking with a real human?');
            const conversationHistory = callState.conversationHistory.map(h => ({
              type: h.type,
              text: h.text || '',
            }));
            
            isRealHuman = await aiService.confirmTransferRequest(
              config as TransferConfig,
              speechResult,
              conversationHistory
            );

            if (!isRealHuman) {
              console.log('❌ AI confirmed this is NOT a real human - likely automated system');
              console.log('   Speech was:', speechResult.substring(0, 100));
              // Continue with normal flow, don't transfer
              // Fall through to IVR menu processing
            } else {
              console.log('✅ AI confirmed we ARE speaking with a real human');
              // Proceed to ask if we're speaking with a human
            }
          } catch (error: unknown) {
            const err = error as Error;
            console.error('❌ Error validating with AI:', err.message);
            // On error, be conservative and don't transfer
            isRealHuman = false;
            // Continue with normal flow
          }

          // Only ask about human if AI confirmed we're speaking with a real human
          if (isRealHuman) {
            askForHumanConfirmation(response, baseUrl, config, callSid);
            res.type('text/xml');
            res.send(response.toString());
            return;
          }
          // If AI didn't validate, continue with normal flow (IVR menu processing)
        } else {
          // Human already confirmed - transfer immediately
          console.log(`🔄 Human confirmed - transferring to ${config.transferNumber}`);

          initiateTransfer(
            response,
            baseUrl,
            config,
            callSid
          );

          res.type('text/xml');
          res.send(response.toString());
          return;
        }
      }

      if (callState.awaitingCompleteMenu) {
        console.log('📋 Checking if speech continues incomplete menu...');
        const isContinuingMenu =
          ivrDetector.isIVRMenu(speechResult) ||
          /\b(for|press|select|choose)\s*\d+/i.test(speechResult) ||
          /\b\d+\s+(for|to|press)/i.test(speechResult);

        if (isContinuingMenu) {
          console.log('✅ Speech continues menu - merging options...');
        } else {
          console.log(
            '⚠️ Speech does not continue menu - clearing awaiting flag'
          );
          callStateManager.updateCallState(callSid, {
            awaitingCompleteMenu: false,
            partialMenuOptions: [],
          });
        }
      }

      const isIVRMenu = ivrDetector.isIVRMenu(speechResult);
      console.log('📋 Checking for IVR menu...');
      console.log('  isIVRMenu:', isIVRMenu);
      console.log('  awaitingCompleteMenu:', callState.awaitingCompleteMenu);

      if (isIVRMenu || callState.awaitingCompleteMenu) {
        console.log('📋 IVR Menu detected - processing menu options');
        const menuOptions = ivrDetector.extractMenuOptions(speechResult);
        console.log(
          '📋 Extracted menu options:',
          JSON.stringify(menuOptions, null, 2)
        );

        const isIncomplete = ivrDetector.isIncompleteMenu(
          speechResult,
          menuOptions
        );
        console.log('📋 Is incomplete menu:', isIncomplete);

        if (isIncomplete) {
          // Even if menu appears incomplete, use AI to check if we have a good match
          // Custom instructions take priority, otherwise check if option matches "speak with a representative"
          if (menuOptions.length > 0) {
            console.log(
              '🤖 Checking incomplete menu options with AI for early match...'
            );
            try {
              // Merge with any previous partial options for context
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
              }

              const aiDecision =
                await aiDTMFService.understandCallPurposeAndPressDTMF(
                  speechResult,
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
                console.log(
                  `✅ AI found good match in incomplete menu: Press ${aiDecision.digit} for ${matchedOption?.option || aiDecision.matchedOption} - proceeding immediately`
                );
                console.log(`   Reason: ${aiDecision.reason}`);

                callStateManager.updateCallState(callSid, {
                  partialMenuOptions: [],
                  awaitingCompleteMenu: false,
                  lastMenuOptions: allMenuOptions,
                  menuLevel: (callState.menuLevel || 0) + 1,
                });
                callHistoryService.addIVRMenu(callSid, allMenuOptions);

                const digitToPress = aiDecision.digit;
                console.log(
                  `✅ Pressing DTMF ${digitToPress} (AI confirmed match)`
                );

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
              } else {
                console.log(
                  `⚠️ AI did not find a match in incomplete menu - waiting for more options`
                );
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

          console.log(
            '⚠️ Menu appears incomplete - waiting for complete menu...'
          );
          console.log(
            `   Found only ${menuOptions.length} option(s), waiting for more...`
          );

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
            action: buildProcessSpeechUrl(baseUrl, config),
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
          console.log('📋 Merging with previous partial menu options...');
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

        const loopCheck = loopDetector.detectLoop(allMenuOptions);
        if (loopCheck && loopCheck.isLoop) {
          console.log(`🔄 ${loopCheck.message} - Acting immediately`);
          const bestOption =
            allMenuOptions.find(
              (opt: { digit: string; option: string }) =>
                opt.option.includes('representative') ||
                opt.option.includes('agent') ||
                opt.option.includes('other') ||
                opt.option.includes('operator')
            ) || allMenuOptions[0];

          if (bestOption) {
            const digitToPress = bestOption.digit;
            console.log(
              `✅ Pressing DTMF ${digitToPress} immediately (loop detected)`
            );

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

        // Track options for loop detection (handled internally by detectLoop)

        callStateManager.updateCallState(callSid, {
          lastMenuOptions: allMenuOptions,
          menuLevel: (callState.menuLevel || 0) + 1,
        });

        console.log('🤖 Using AI to select best option...');
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
            `✅ AI selected: Press ${digitToPress} (${aiDecision.matchedOption})`
          );
        } else {
          const repOption = allMenuOptions.find(
            (opt: { digit: string; option: string }) =>
              opt.option.includes('representative') ||
              opt.option.includes('agent') ||
              opt.option.includes('operator') ||
              opt.option.includes('customer service') ||
              opt.option.includes('speak to')
          );

          if (repOption) {
            digitToPress = repOption.digit;
            console.log(
              `✅ Selected representative option: Press ${digitToPress} (${repOption.option})`
            );
          } else {
            const supportOption = allMenuOptions.find(
              (opt: { digit: string; option: string }) =>
                opt.option.includes('technical support') ||
                opt.option.includes('support') ||
                opt.option.includes('help') ||
                opt.option.includes('assistance')
            );

            if (supportOption) {
              digitToPress = supportOption.digit;
              console.log(
                `✅ Selected support option: Press ${digitToPress} (${supportOption.option})`
              );
            } else {
              const otherOption = allMenuOptions.find(
                (opt: { digit: string; option: string }) =>
                  opt.option.includes('other') ||
                  opt.option.includes('all other') ||
                  opt.option.includes('additional')
              );

              if (otherOption) {
                digitToPress = otherOption.digit;
                console.log(
                  `✅ Selected "other" option: Press ${digitToPress} (${otherOption.option})`
                );
              } else {
                console.log(
                  '⚠️ No suitable option found for "speak with a representative" - waiting silently'
                );
                callHistoryService
                  .addConversation(
                    callSid,
                    'system',
                    '[No suitable option found - waiting silently]'
                  )
                  .catch(err =>
                    console.error('Error adding conversation:', err)
                  );
                digitToPress = null;
              }
            }
          }
        }

        if (digitToPress) {
          console.log(
            `⏳ Waiting for silence before pressing ${digitToPress}...`
          );

          const reason =
            aiDecision && aiDecision.matchedOption
              ? `AI selected: ${aiDecision.matchedOption}`
              : 'Selected best option';
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
          console.log('⚠️ No matching option found - waiting silently');
          callHistoryService
            .addConversation(
              callSid,
              'system',
              '[No matching option found - waiting silently]'
            )
            .catch(err => console.error('Error adding conversation:', err));
          const gatherAttributes = createGatherAttributes(config, {
            action: buildProcessSpeechUrl(baseUrl, config),
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


      if (callState.awaitingCompleteMenu) {
        console.log(
          '⚠️ Still awaiting complete menu - remaining silent, waiting for more options'
        );
        callHistoryService
          .addConversation(
            callSid,
            'system',
            '[Waiting for complete menu - remaining silent]'
          )
          .catch(err => console.error('Error adding conversation:', err));
        const gatherAttributes = createGatherAttributes(config, {
          action: buildProcessSpeechUrl(baseUrl, config),
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
      console.log('🤖 Calling AI service...');
      console.log('  Speech:', speechResult);
      console.log('  Is first call:', isFirstCall);
      console.log('  Conversation history length:', conversationHistory.length);
      console.log('  Custom instructions:', config.customInstructions || '(none)');
      console.log('  Call purpose:', config.callPurpose || '(none)');

      let aiResponse: string;
      try {
        // Add timeout to prevent hanging
        const aiPromise = aiService.generateResponse(
          config as TransferConfig,
          speechResult,
          isFirstCall,
          conversationHistory.map(h => ({ type: h.type, text: h.text || '' }))
        );

        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(
            () => reject(new Error(`AI service timeout after ${DEFAULT_SPEECH_TIMEOUT} seconds`)),
            DEFAULT_SPEECH_TIMEOUT * 1000
          );
        });

        aiResponse = await Promise.race([aiPromise, timeoutPromise]);
        console.log('✅ OpenAI response received:', aiResponse);
      } catch (error: unknown) {
        const err = toError(error);
        console.error('❌ AI service error:', err.message);
        console.error('  Error stack:', err.stack);
        // Fallback: remain silent on AI error
        aiResponse = 'silent';
        console.log('⚠️ Using fallback: remaining silent due to AI error');
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
      } else {
        console.log('🤫 AI chose to remain silent - not speaking');
        callHistoryService
          .addConversation(callSid, 'system', '[AI remained silent]')
          .catch(err => console.error('Error adding conversation:', err));
      }

      const gatherAttributes = createGatherAttributes(config, {
        action: `${baseUrl}/voice/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
        method: 'POST',
        enhanced: true,
        timeout: DEFAULT_SPEECH_TIMEOUT,
      });
      console.log('🎤 Setting up gather for next speech segment...');
      console.log('  Timeout:', gatherAttributes.timeout, 'seconds');
      console.log('  SpeechTimeout:', gatherAttributes.speechTimeout);
      response.gather(
        gatherAttributes as Parameters<typeof response.gather>[0]
      );

      console.log(
        '📤 Sending TwiML response with gather action:',
        gatherAttributes.action
      );
      res.type('text/xml');
      res.send(response.toString());
      console.log('✅ TwiML response sent');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('❌ Error in /process-speech:', error);
      console.error('Error message:', errorMessage);
      console.error('Error stack:', errorStack);
      console.error('Call SID:', req.body.CallSid);
      console.error('Speech Result:', req.body.SpeechResult);
      console.error('Query params:', req.query);

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
  console.log('📥 /process-dtmf endpoint called');
  console.log('Request body Digits:', req.body.Digits);
  console.log('Request query Digits:', req.query.Digits);

  const digits = req.body.Digits || req.query.Digits;
  const baseUrl = getBaseUrl(req);
  console.log('Base URL:', baseUrl);

  const callSid = req.body.CallSid;
  const callState = callStateManager.getCallState(callSid);
  const customInstructionsFromState = callState.customInstructions;
  const customInstructionsFromQuery = (req.query.customInstructions as string) || '';
  const finalCustomInstructions = customInstructionsFromQuery || customInstructionsFromState || '';

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

  console.log('🔢 DTMF processed:', digits);
  console.log('Call SID:', req.body.CallSid);

  const response = new twilio.twiml.VoiceResponse();
  const gatherAttributes = createGatherAttributes(config, {
    action: buildProcessSpeechUrl(baseUrl, config),
    method: 'POST',
    enhanced: true,
              timeout: DEFAULT_SPEECH_TIMEOUT, // Increased to capture longer IVR menus
  });
  response.gather(gatherAttributes as Parameters<typeof response.gather>[0]);

  console.log(
    '📤 Sending TwiML response with gather action:',
    gatherAttributes.action
  );
  res.type('text/xml');
  res.send(response.toString());
  console.log('✅ TwiML response sent from /process-dtmf');
});

/**
 * Call status callback - handles status updates from Twilio for main calls
 */
router.post('/call-status', (req: Request, res: Response) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus as TwilioCallStatus | undefined;
  console.log('📞 Call status update:', callStatus, 'for CallSid:', callSid);

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
  console.log('🔄 Transfer status:', callStatus);

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
