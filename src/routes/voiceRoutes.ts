/**
 * Voice Routes - Transfer-Only Mode
 * Handles Twilio voice webhooks for transfer-only phone navigation
 */

import express, { Request, Response } from 'express';
import twilio from 'twilio';
import transferConfig from '../config/transfer-config';
import callStateManager from '../services/callStateManager';
import callHistoryService from '../services/callHistoryService';
import * as ivrDetector from '../utils/ivrDetector';
import * as transferDetector from '../utils/transferDetector';
import * as terminationDetector from '../utils/terminationDetector';
import { LoopDetector } from '../services/callStateManager';
import aiService from '../services/aiService';
import aiDTMFService from '../services/aiDTMFService';
import twilioService from '../services/twilioService';
import { TransferConfig } from '../services/aiService';
import { TransferConfig as TransferConfigType } from '../config/transfer-config';

const router = express.Router();

// Helper to create a LoopDetector instance
function createLoopDetector(): LoopDetector {
  const seenOptions: string[] = [];
  return {
    detectLoop: (options: { digit: string; option: string }[]) => {
      const optionKey = options.map(o => `${o.digit}:${o.option}`).join('|');
      if (seenOptions.includes(optionKey)) {
        return { isLoop: true, message: 'Detected repeating menu options' };
      }
      seenOptions.push(optionKey);
      return { isLoop: false };
    },
    reset: () => {
      seenOptions.length = 0;
    }
  };
}

// Type definitions for Twilio TwiML properties that aren't fully typed
interface TwiMLDialAttributes {
  answerOnMedia?: boolean;
  [key: string]: unknown;
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
      transferNumber: req.query.transferNumber as string || process.env.TRANSFER_PHONE_NUMBER,
      userPhone: req.query.userPhone as string || process.env.USER_PHONE_NUMBER,
      userEmail: req.query.userEmail as string || process.env.USER_EMAIL,
      callPurpose: req.query.callPurpose as string || 'speak with a representative',
      customInstructions: req.query.customInstructions as string || ''
    });
    
    console.log('📞 Call received - Transfer-Only Mode');
    console.log('Call SID:', callSid);
    console.log('Transfer Number:', config.transferNumber);
    console.log('Call Purpose:', config.callPurpose);
    
    callStateManager.updateCallState(callSid, { 
      transferConfig: config as TransferConfigType,
      loopDetector: createLoopDetector(),
      holdStartTime: null
    });
    
    callHistoryService.startCall(callSid, {
      to: req.body.To || req.body.Called,
      from: req.body.From || req.body.Caller,
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose,
      customInstructions: config.customInstructions
    }).catch(err => console.error('Error starting call history:', err));
    
    const response = new twilio.twiml.VoiceResponse();
    response.gather({
      input: ['speech'] as any,
      language: (config.aiSettings.language || 'en-US') as any,
      speechTimeout: 'auto',
      action: `${baseUrl}/process-speech?firstCall=true&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}${config.customInstructions ? '&customInstructions=' + encodeURIComponent(config.customInstructions) : ''}`,
      method: 'POST',
      enhanced: true,
      timeout: 10,
    });
    
    response.say(
      { voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any },
      'Thank you. Goodbye.'
    );
    response.hangup();
    
    res.type('text/xml');
    res.send(response.toString());
    return;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in /voice endpoint:', errorMessage);
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'alice', language: 'en-US' }, 'I apologize, but there was an error. Please try again later.');
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
  }
});

/**
 * Process speech - main conversation handler
 */
router.post('/process-speech', async (req: Request, res: Response): Promise<void> => {
  const response = new twilio.twiml.VoiceResponse();
  
  try {
    const callSid = req.body.CallSid;
    const speechResult = req.body.SpeechResult || '';
    const isFirstCall = req.query.firstCall === 'true';
    const baseUrl = getBaseUrl(req);
    
    const config = transferConfig.createConfig({
      transferNumber: req.query.transferNumber as string || process.env.TRANSFER_PHONE_NUMBER,
      userPhone: req.query.userPhone as string || process.env.USER_PHONE_NUMBER,
      userEmail: req.query.userEmail as string || process.env.USER_EMAIL,
      callPurpose: req.query.callPurpose as string || 'speak with a representative',
      customInstructions: req.query.customInstructions as string || ''
    });
    
    console.log('🎤 Received speech:', speechResult);
    console.log('Call SID:', callSid);
    console.log('Is first call:', isFirstCall);
    
    if (!callSid) {
      throw new Error('Call SID is missing');
    }
    
    const callState = callStateManager.getCallState(callSid);
    if (!callState.loopDetector) {
      callStateManager.updateCallState(callSid, { loopDetector: createLoopDetector() });
    }
    const loopDetector = callState.loopDetector!;
    
    const previousSpeech = callState.lastSpeech || '';
    const termination = terminationDetector.shouldTerminate(speechResult, previousSpeech, 0);
    if (termination.shouldTerminate) {
      console.log(`🛑 ${termination.message}`);
      
      callHistoryService.addTermination(callSid, termination.reason || termination.message || '').catch(err => console.error('Error adding termination:', err));
      callHistoryService.endCall(callSid, 'terminated').catch(err => console.error('Error ending call:', err));
      
      response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any }, 'Thank you. Goodbye.');
      response.hangup();
      callStateManager.clearCallState(callSid);
      res.type('text/xml');
      res.send(response.toString());
      return;
    }
    
    callStateManager.updateCallState(callSid, { lastSpeech: speechResult });
    callHistoryService.addConversation(callSid, 'user', speechResult).catch(err => console.error('Error adding conversation:', err));
    
    if (callState.awaitingCompleteMenu) {
      console.log('📋 Checking if speech continues incomplete menu...');
      const isContinuingMenu = ivrDetector.isIVRMenu(speechResult) || 
                               /\b(for|press|select|choose)\s*\d+/i.test(speechResult) ||
                               /\b\d+\s+(for|to|press)/i.test(speechResult);
      
      if (isContinuingMenu) {
        console.log('✅ Speech continues menu - merging options...');
      } else {
        console.log('⚠️ Speech does not continue menu - clearing awaiting flag');
        callStateManager.updateCallState(callSid, {
          awaitingCompleteMenu: false,
          partialMenuOptions: []
        });
      }
    }
    
    const isIVRMenu = ivrDetector.isIVRMenu(speechResult);
    
    if (isIVRMenu || callState.awaitingCompleteMenu) {
      console.log('📋 IVR Menu detected');
      const menuOptions = ivrDetector.extractMenuOptions(speechResult);
      
      const isIncomplete = ivrDetector.isIncompleteMenu(speechResult, menuOptions);
      
      if (isIncomplete) {
        console.log('⚠️ Menu appears incomplete - waiting for complete menu...');
        console.log(`   Found only ${menuOptions.length} option(s), waiting for more...`);
        
        callStateManager.updateCallState(callSid, {
          partialMenuOptions: menuOptions,
          awaitingCompleteMenu: true
        });
        
        const menuSummary = menuOptions.length > 0 
          ? `[IVR Menu incomplete - found: ${menuOptions.map((o: { digit: string; option: string }) => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`
          : '[IVR Menu detected but no options extracted yet. Waiting for complete menu...]';
        callHistoryService.addConversation(callSid, 'system', menuSummary).catch(err => console.error('Error adding conversation:', err));
        
        response.gather({
          input: ['speech'] as any,
          language: (config.aiSettings.language || 'en-US') as any,
          speechTimeout: 'auto',
          action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
          method: 'POST',
          enhanced: true,
          timeout: 10,
        });
        res.type('text/xml');
        res.send(response.toString());
        return;
      }
      
      let allMenuOptions = menuOptions;
      if (callState.partialMenuOptions && callState.partialMenuOptions.length > 0) {
        console.log('📋 Merging with previous partial menu options...');
        allMenuOptions = [...callState.partialMenuOptions, ...menuOptions];
        const seen = new Set<string>();
        allMenuOptions = allMenuOptions.filter((opt: { digit: string; option: string }) => {
          const key = `${opt.digit}-${opt.option}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        callStateManager.updateCallState(callSid, {
          partialMenuOptions: [],
          awaitingCompleteMenu: false
        });
      }
      
      callHistoryService.addIVRMenu(callSid, allMenuOptions);
      
      const loopCheck = loopDetector.detectLoop(allMenuOptions);
      if (loopCheck && loopCheck.isLoop) {
        console.log(`🔄 ${loopCheck.message} - Acting immediately`);
        const bestOption = allMenuOptions.find((opt: { digit: string; option: string }) => 
          opt.option.includes('representative') || 
          opt.option.includes('agent') || 
          opt.option.includes('other') ||
          opt.option.includes('operator')
        ) || allMenuOptions[0];
        
        if (bestOption) {
          const digitToPress = bestOption.digit;
          console.log(`✅ Pressing DTMF ${digitToPress} immediately (loop detected)`);
          
          callHistoryService.addDTMF(callSid, digitToPress, 'Loop detected - immediate press').catch(err => console.error('Error adding DTMF:', err));
          
          response.pause({ length: 0.5 });
          setTimeout(async () => {
            await twilioService.sendDTMF(callSid, digitToPress);
          }, 500);
          response.redirect(`${baseUrl}/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`);
          res.type('text/xml');
          res.send(response.toString());
          return;
        }
      }
      
      // Track options for loop detection (handled internally by detectLoop)
      
      callStateManager.updateCallState(callSid, {
        lastMenuOptions: allMenuOptions,
        menuLevel: (callState.menuLevel || 0) + 1
      });
      
      console.log('🤖 Using AI to select best option...');
      const aiDecision = await aiDTMFService.understandCallPurposeAndPressDTMF(
        speechResult, 
        { callPurpose: config.callPurpose }, 
        allMenuOptions
      );
      
      let digitToPress: string | null = null;
      if (aiDecision.shouldPress && aiDecision.digit) {
        digitToPress = aiDecision.digit;
        console.log(`✅ AI selected: Press ${digitToPress} (${aiDecision.matchedOption})`);
      } else {
        const repOption = allMenuOptions.find((opt: { digit: string; option: string }) => 
          opt.option.includes('representative') || 
          opt.option.includes('agent') || 
          opt.option.includes('operator') ||
          opt.option.includes('customer service') ||
          opt.option.includes('speak to')
        );
        
        if (repOption) {
          digitToPress = repOption.digit;
          console.log(`✅ Selected representative option: Press ${digitToPress} (${repOption.option})`);
        } else {
          const supportOption = allMenuOptions.find((opt: { digit: string; option: string }) => 
            opt.option.includes('technical support') ||
            opt.option.includes('support') ||
            opt.option.includes('help') ||
            opt.option.includes('assistance')
          );
          
          if (supportOption) {
            digitToPress = supportOption.digit;
            console.log(`✅ Selected support option: Press ${digitToPress} (${supportOption.option})`);
          } else {
            const otherOption = allMenuOptions.find((opt: { digit: string; option: string }) => 
              opt.option.includes('other') ||
              opt.option.includes('all other') ||
              opt.option.includes('additional')
            );
            
            if (otherOption) {
              digitToPress = otherOption.digit;
              console.log(`✅ Selected "other" option: Press ${digitToPress} (${otherOption.option})`);
            } else {
              console.log('⚠️ No suitable option found for "speak with a representative" - waiting silently');
              callHistoryService.addConversation(callSid, 'system', '[No suitable option found - waiting silently]').catch(err => console.error('Error adding conversation:', err));
              digitToPress = null;
            }
          }
        }
      }
      
      if (digitToPress) {
        console.log(`⏳ Waiting for silence before pressing ${digitToPress}...`);
        
        const reason = aiDecision && aiDecision.matchedOption 
          ? `AI selected: ${aiDecision.matchedOption}` 
          : 'Selected best option';
        callHistoryService.addDTMF(callSid, digitToPress, reason).catch(err => console.error('Error adding DTMF:', err));
        
        response.pause({ length: 2 });
        setTimeout(async () => {
          await twilioService.sendDTMF(callSid, digitToPress!);
        }, 2000);
        response.redirect(`${baseUrl}/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`);
        res.type('text/xml');
        res.send(response.toString());
        return;
      } else {
        console.log('⚠️ No matching option found - waiting silently');
        callHistoryService.addConversation(callSid, 'system', '[No matching option found - waiting silently]').catch(err => console.error('Error adding conversation:', err));
        response.gather({
          input: ['speech'] as any,
          language: (config.aiSettings.language || 'en-US') as any,
          speechTimeout: 'auto',
          action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
          method: 'POST',
          enhanced: true,
          timeout: 10,
        });
        res.type('text/xml');
        res.send(response.toString());
        return;
      }
    }
    
    if (transferDetector.wantsTransfer(speechResult)) {
      console.log('🔄 Transfer request detected');
      
      const needsConfirmation = !callState.humanConfirmed;
      if (needsConfirmation) {
        console.log('❓ Confirming human before transfer...');
        response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any }, 'Am I speaking with a real person or is this the automated system?');
        callStateManager.updateCallState(callSid, { awaitingHumanConfirmation: true });
        response.gather({
          input: ['speech'] as any,
          language: (config.aiSettings.language || 'en-US') as any,
          speechTimeout: 'auto',
          action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
          method: 'POST',
          enhanced: true,
          timeout: 10,
        });
        res.type('text/xml');
        res.send(response.toString());
        return;
      }
      
      console.log(`🔄 Transferring to ${config.transferNumber}`);
      
      callHistoryService.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
      
      response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any }, 'Hold on, please.');
      response.pause({ length: 1 });
      
      const dial = response.dial({
        action: `${baseUrl}/transfer-status`,
        method: 'POST',
        timeout: 30,
      });
      (dial as TwiMLDialAttributes).answerOnMedia = true;
      dial.number(config.transferNumber);
      
      res.type('text/xml');
      res.send(response.toString());
      return;
    }
    
    const isHumanConfirmation = /(?:yes|yeah|correct|right|real person|human|yes i am|yes this is|yes you are|talking to a real person|speaking with a real person)/i.test(speechResult);
    
    if (callState.awaitingHumanConfirmation || isHumanConfirmation) {
      if (isHumanConfirmation) {
        console.log('✅ Human confirmed - transferring');
        callStateManager.updateCallState(callSid, { humanConfirmed: true, awaitingHumanConfirmation: false });
        
        callHistoryService.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
        
        response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any }, 'Thank you. Hold on, please.');
        response.pause({ length: 1 });
        
        const dial = response.dial({
          action: `${baseUrl}/transfer-status`,
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
    
    if (transferDetector.wantsTransfer(speechResult) && callState.humanConfirmed) {
      console.log('🔄 Transfer phrase detected and human already confirmed - transferring immediately');
      
      callHistoryService.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
      
      response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any }, 'Hold on, please.');
      response.pause({ length: 1 });
      
      const dial = response.dial({
        action: `${baseUrl}/transfer-status`,
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
      console.log('⚠️ Still awaiting complete menu - remaining silent, waiting for more options');
      callHistoryService.addConversation(callSid, 'system', '[Waiting for complete menu - remaining silent]').catch(err => console.error('Error adding conversation:', err));
        response.gather({
          input: ['speech'] as any,
          language: (config.aiSettings.language || 'en-US') as any,
        speechTimeout: 'auto',
        action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
        method: 'POST',
        enhanced: true,
        timeout: 10,
      });
      res.type('text/xml');
      res.send(response.toString());
      return;
    }
    
    const conversationHistory = callState.conversationHistory || [];
    const aiResponse = await aiService.generateResponse(
      config as TransferConfig,
      speechResult,
      isFirstCall,
      conversationHistory.map(h => ({ type: h.type, text: h.text || '' }))
    );
    
    console.log('OpenAI response:', aiResponse);
    
    callStateManager.addToHistory(callSid, {
      type: 'system',
      text: speechResult
    });
    
    if (aiResponse && aiResponse.trim().toLowerCase() !== 'silent' && aiResponse.trim().length > 0) {
      callStateManager.addToHistory(callSid, {
        type: 'ai',
        text: aiResponse
      });
      
      callHistoryService.addConversation(callSid, 'ai', aiResponse).catch(err => console.error('Error adding conversation:', err));
      
      response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew') as any, language: (config.aiSettings.language || 'en-US') as any }, aiResponse);
    } else {
      console.log('🤫 AI chose to remain silent - not speaking');
      callHistoryService.addConversation(callSid, 'system', '[AI remained silent]').catch(err => console.error('Error adding conversation:', err));
    }
    
    response.gather({
      input: ['speech'] as any,
      language: (config.aiSettings.language || 'en-US') as any,
      speechTimeout: 'auto',
      action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
      method: 'POST',
      enhanced: true,
      timeout: 10,
    });
    
    res.type('text/xml');
    res.send(response.toString());
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error in /process-speech:', error);
    console.error('Error message:', errorMessage);
    console.error('Error stack:', errorStack);
    console.error('Call SID:', req.body.CallSid);
    console.error('Speech Result:', req.body.SpeechResult);
    console.error('Query params:', req.query);
    
    const errorResponse = new twilio.twiml.VoiceResponse();
    errorResponse.say({ voice: 'alice', language: 'en-US' }, 'I apologize, but an application error has occurred. Please try again later.');
    errorResponse.hangup();
    res.type('text/xml');
    res.send(errorResponse.toString());
  }
});

/**
 * Process DTMF - handle DTMF key presses
 */
router.post('/process-dtmf', (req: Request, res: Response) => {
  const digits = req.body.Digits || req.query.Digits;
  const baseUrl = getBaseUrl(req);
  
  const config = transferConfig.createConfig({
    transferNumber: req.query.transferNumber as string || process.env.TRANSFER_PHONE_NUMBER,
    callPurpose: req.query.callPurpose as string || 'speak with a representative'
  });
  
  console.log('🔢 DTMF processed:', digits);
  
  const response = new twilio.twiml.VoiceResponse();
  response.gather({
    input: ['speech'] as any,
    language: (config.aiSettings.language || 'en-US') as any,
    speechTimeout: 'auto',
    action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
    method: 'POST',
    enhanced: true,
    timeout: 10,
  });
  
  res.type('text/xml');
  res.send(response.toString());
});

/**
 * Transfer status callback
 */
router.post('/transfer-status', (req: Request, res: Response) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  console.log('🔄 Transfer status:', callStatus);
  
  if ((callStatus === 'completed' || callStatus === 'failed') && callSid) {
    callHistoryService.endCall(callSid, callStatus as 'completed' | 'failed').catch(err => console.error('Error ending call:', err));
  }
  
  const response = new twilio.twiml.VoiceResponse();
  res.type('text/xml');
  res.send(response.toString());
});

export default router;

