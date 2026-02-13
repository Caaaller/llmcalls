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
    // Increase default timeout to 15 seconds to capture longer IVR menus
    timeout: 15,
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
      action: buildProcessSpeechUrl(baseUrl, config, { firstCall: 'true' }),
      method: 'POST',
      enhanced: true,
      timeout: 15, // Increased to capture longer IVR menus
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
      const customInstructionsFromQuery =
        (req.query.customInstructions as string) || '';
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
      console.log('📥 Config created');
      console.log(
        '📥 Custom instructions:',
        config.customInstructions || '(none)'
      );

      console.log('🎤 Received speech:', speechResult);
      console.log('  Speech length:', speechResult?.length || 0, 'characters');
      // Note: finalSpeech will be set below after merge logic
      console.log('  Call SID:', callSid);
      console.log('  Is first call:', isFirstCall);

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
      let finalSpeech = speechResult;
      if (callState.awaitingCompleteSpeech && callState.lastSpeech) {
        console.log('📝 Merging partial speech with continuation...');
        console.log(`  Previous: "${callState.lastSpeech}"`);
        console.log(`  New: "${speechResult}"`);
        // Merge: combine previous partial speech with new speech
        finalSpeech = `${callState.lastSpeech} ${speechResult}`.trim();
        console.log(`  Merged: "${finalSpeech}"`);
        callStateManager.updateCallState(callSid, {
          awaitingCompleteSpeech: false,
        });
      }

      const previousSpeech = callState.lastSpeech || '';
      // Use AI-powered termination detection with finalSpeech
      const termination = await aiDetectionService.detectTermination(
        finalSpeech,
        previousSpeech,
        0
      );
      if (termination.shouldTerminate) {
        console.log(
          `🛑 ${termination.message} (confidence: ${termination.confidence})`
        );

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
          console.log(
            `⚠️ Incomplete speech detected (confidence: ${incompleteCheck.confidence}) - ${incompleteCheck.reason}`
          );
          console.log(
            `⏳ Waiting for more speech (attempt ${incompleteSpeechWaitCount + 1}/${maxIncompleteWaits}, suggested wait: ${incompleteCheck.suggestedWaitTime || 5}s)`
          );

          // Store partial speech and wait for more
          callStateManager.updateCallState(callSid, {
            lastSpeech: finalSpeech,
            awaitingCompleteSpeech: true,
            incompleteSpeechWaitCount: incompleteSpeechWaitCount + 1,
          });

          // Set up gather with shorter timeout to capture continuation
          const waitTime = incompleteCheck.suggestedWaitTime || 5;
          const gatherAttributes = createGatherAttributes(config, {
            action: buildProcessSpeechUrl(baseUrl, config),
            method: 'POST',
            enhanced: true,
            timeout: waitTime,
          });
          response.gather(
            gatherAttributes as Parameters<typeof response.gather>[0]
          );
          res.type('text/xml');
          res.send(response.toString());
          return;
        }
      } else if (incompleteSpeechWaitCount >= maxIncompleteWaits) {
        console.log(
          `⚠️ Reached maximum incomplete speech waits (${maxIncompleteWaits}), processing speech as-is`
        );
      } else if (isIncompleteCheckIVRMenu) {
        console.log(
          `📋 Detected IVR menu, treating speech as complete (IVR menus can span multiple segments)`
        );
      } else if (finalSpeech.length >= 500) {
        console.log(
          `⚠️ Speech already very long (${finalSpeech.length} chars), processing as-is to prevent infinite merging`
        );
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
        console.log(
          `🔄 Transfer request detected (confidence: ${transferDetection.confidence}) - ${transferDetection.reason}`
        );

        const needsConfirmation = !callState.humanConfirmed;
        if (needsConfirmation) {
          console.log('❓ Confirming human before transfer...');
          const sayAttributes = createSayAttributes(config);
          response.say(
            sayAttributes as Parameters<typeof response.say>[0],
            'Am I speaking with a real person or is this the automated system?'
          );
          callStateManager.updateCallState(callSid, {
            awaitingHumanConfirmation: true,
          });
          const gatherAttributes = createGatherAttributes(config, {
            action: buildProcessSpeechUrl(baseUrl, config),
            method: 'POST',
            enhanced: true,
            timeout: 10,
          });
          response.gather(
            gatherAttributes as Parameters<typeof response.gather>[0]
          );
          res.type('text/xml');
          res.send(response.toString());
          return;
        }

        console.log(`🔄 Transferring to ${config.transferNumber}`);

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
        console.log('📋 Checking if speech continues incomplete menu...');
        // Use AI to detect if speech continues menu
        const menuDetection =
          await aiDetectionService.detectIVRMenu(finalSpeech);
        const isContinuingMenu = menuDetection.isIVRMenu;

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

      // Use AI-powered IVR menu detection
      const menuDetection = await aiDetectionService.detectIVRMenu(finalSpeech);
      const isIVRMenu = menuDetection.isIVRMenu;
      console.log('📋 Checking for IVR menu...');
      console.log(
        `  isIVRMenu: ${isIVRMenu} (confidence: ${menuDetection.confidence})`
      );
      console.log('  awaitingCompleteMenu:', callState.awaitingCompleteMenu);

      if (isIVRMenu || callState.awaitingCompleteMenu) {
        console.log('📋 IVR Menu detected - processing menu options');
        // Use AI-powered menu extraction
        const extractionResult =
          await aiDetectionService.extractMenuOptions(finalSpeech);
        const menuOptions = extractionResult.menuOptions;
        console.log(
          '📋 Extracted menu options:',
          JSON.stringify(menuOptions, null, 2)
        );
        console.log(
          `  Confidence: ${extractionResult.confidence}, Complete: ${extractionResult.isComplete}`
        );

        const isIncomplete = !extractionResult.isComplete;
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
            timeout: 15, // Increased to capture longer IVR menus
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

        // Use AI-powered loop detection (semantic matching)
        const previousMenus = callState.previousMenus || [];
        const loopCheck = await aiDetectionService.detectLoop(
          allMenuOptions,
          previousMenus
        );
        if (loopCheck.isLoop && loopCheck.confidence > 0.7) {
          console.log(
            `🔄 ${loopCheck.reason} - Acting immediately (confidence: ${loopCheck.confidence})`
          );
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

        // Track previous menus for AI loop detection
        const updatedPreviousMenus = [...previousMenus, allMenuOptions];
        callStateManager.updateCallState(callSid, {
          lastMenuOptions: allMenuOptions,
          previousMenus: updatedPreviousMenus,
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

        // Use AI DTMF decision - no static fallback, rely entirely on AI
        let digitToPress: string | null = null;
        if (aiDecision.shouldPress && aiDecision.digit) {
          digitToPress = aiDecision.digit;
          console.log(
            `✅ AI selected: Press ${digitToPress} (${aiDecision.matchedOption}) - ${aiDecision.reason}`
          );
        } else {
          console.log(
            `⚠️ AI determined no suitable option found - ${aiDecision.reason}`
          );
          callHistoryService
            .addConversation(
              callSid,
              'system',
              `[AI: No suitable option - ${aiDecision.reason}]`
            )
            .catch(err => console.error('Error adding conversation:', err));
          digitToPress = null;
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
            timeout: 15, // Increased to capture longer IVR menus
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
          console.log(
            `✅ Human confirmed - transferring (confidence: ${humanConfirmation.confidence}) - ${humanConfirmation.reason}`
          );
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
          dial.number(config.transferNumber);

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
          timeout: 15, // Increased to capture longer IVR menus
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
      console.log('  Speech:', finalSpeech);
      console.log('  Is first call:', isFirstCall);
      console.log('  Conversation history length:', conversationHistory.length);
      console.log(
        '  Custom instructions:',
        config.customInstructions || '(none)'
      );
      console.log('  Call purpose:', config.callPurpose || '(none)');

      let aiResponse: string;
      try {
        // Add timeout to prevent hanging (15 seconds max)
        const aiPromise = aiService.generateResponse(
          config as TransferConfig,
          finalSpeech,
          isFirstCall,
          conversationHistory.map(h => ({ type: h.type, text: h.text || '' }))
        );

        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(
            () => reject(new Error('AI service timeout after 15 seconds')),
            15000
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
        timeout: 15, // Increased to capture longer IVR menus
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
  const customInstructionsFromQuery =
    (req.query.customInstructions as string) || '';
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

  console.log('🔢 DTMF processed:', digits);
  console.log('Call SID:', req.body.CallSid);

  const response = new twilio.twiml.VoiceResponse();
  const gatherAttributes = createGatherAttributes(config, {
    action: buildProcessSpeechUrl(baseUrl, config),
    method: 'POST',
    enhanced: true,
    timeout: 15, // Increased to capture longer IVR menus
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
