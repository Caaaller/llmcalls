/**
 * Voice Routes - Transfer-Only Mode
 * Handles Twilio voice webhooks for transfer-only phone navigation
 */

const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const transferConfig = require('../config/transfer-config');
const callStateManager = require('../services/callStateManager');
const callHistoryService = require('../services/callHistoryService');
const ivrDetector = require('../utils/ivrDetector');
const transferDetector = require('../utils/transferDetector');
const terminationDetector = require('../utils/terminationDetector');
const LoopDetector = require('../utils/loopDetector');
const aiService = require('../services/aiService');
const aiDTMFService = require('../services/aiDTMFService');
const twilioService = require('../services/twilioService');

/**
 * Get base URL from request
 */
function getBaseUrl(req) {
  const protocol = req.protocol || 'https';
  const host = req.get('host') || req.hostname;
  return `${protocol}://${host}`;
}

/**
 * Initial voice webhook - called when call starts
 */
router.post('/voice', (req, res) => {
  try {
    console.log('📞 /voice endpoint called');
    const callSid = req.body.CallSid;
    const baseUrl = getBaseUrl(req);
    
    // Get transfer config from query params
    const config = transferConfig.createConfig({
      transferNumber: req.query.transferNumber || process.env.TRANSFER_PHONE_NUMBER,
      userPhone: req.query.userPhone || process.env.USER_PHONE_NUMBER,
      userEmail: req.query.userEmail || process.env.USER_EMAIL,
      callPurpose: req.query.callPurpose || 'speak with a representative',
      customInstructions: req.query.customInstructions || ''
    });
    
    console.log('📞 Call received - Transfer-Only Mode');
    console.log('Call SID:', callSid);
    console.log('Transfer Number:', config.transferNumber);
    console.log('Call Purpose:', config.callPurpose);
    
    // Initialize call state with config
    const callState = callStateManager.getCallState(callSid);
    callStateManager.updateCallState(callSid, { 
      transferConfig: config,
      loopDetector: new LoopDetector(),
      holdStartTime: null
    });
    
    // Start tracking call history
    callHistoryService.startCall(callSid, {
      to: req.body.To || req.body.Called,
      from: req.body.From || req.body.Caller,
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose,
      customInstructions: config.customInstructions
    }).catch(err => console.error('Error starting call history:', err));
    
    // Start gathering speech silently
    const response = new twilio.twiml.VoiceResponse();
    const gather = response.gather({
      input: 'speech',
      language: config.aiSettings.language || 'en-US',
      speechTimeout: 'auto',
      action: `${baseUrl}/process-speech?firstCall=true&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}${config.customInstructions ? '&customInstructions=' + encodeURIComponent(config.customInstructions) : ''}`,
      method: 'POST',
      enhanced: true,
      timeout: 10,
    });
    
    // Fallback timeout
    response.say(
      { voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' },
      'Thank you. Goodbye.'
    );
    response.hangup();
    
    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    console.error('❌ Error in /voice endpoint:', error);
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
router.post('/process-speech', async (req, res) => {
  const response = new twilio.twiml.VoiceResponse();
  
  try {
    const callSid = req.body.CallSid;
    const speechResult = req.body.SpeechResult || '';
    const isFirstCall = req.query.firstCall === 'true';
    const baseUrl = getBaseUrl(req);
    
    // Get transfer config from query params
    const config = transferConfig.createConfig({
      transferNumber: req.query.transferNumber || process.env.TRANSFER_PHONE_NUMBER,
      userPhone: req.query.userPhone || process.env.USER_PHONE_NUMBER,
      userEmail: req.query.userEmail || process.env.USER_EMAIL,
      callPurpose: req.query.callPurpose || 'speak with a representative',
      customInstructions: req.query.customInstructions || ''
    });
    
    console.log('🎤 Received speech:', speechResult);
    console.log('Call SID:', callSid);
    console.log('Is first call:', isFirstCall);
    
    if (!callSid) {
      throw new Error('Call SID is missing');
    }
    
    // Get call state
    const callState = callStateManager.getCallState(callSid);
    if (!callState.loopDetector) {
      callStateManager.updateCallState(callSid, { loopDetector: new LoopDetector() });
    }
    const loopDetector = callState.loopDetector;
    
    // STEP 1: Check termination conditions
    const previousSpeech = callState.lastSpeech || '';
    const termination = terminationDetector.shouldTerminate(speechResult, previousSpeech, 0);
    if (termination.shouldTerminate) {
      console.log(`🛑 ${termination.message}`);
      
      // Record termination in history
      callHistoryService.addTermination(callSid, termination.reason || termination.message).catch(err => console.error('Error adding termination:', err));
      callHistoryService.endCall(callSid, 'terminated').catch(err => console.error('Error ending call:', err));
      
      response.say({ voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' }, 'Thank you. Goodbye.');
      response.hangup();
      callStateManager.clearCallState(callSid);
      res.type('text/xml');
      return res.send(response.toString());
    }
    
    // Update last speech
    callStateManager.updateCallState(callSid, { lastSpeech: speechResult });
    
    // Record ALL user speech in conversation history (even if we don't respond)
    callHistoryService.addConversation(callSid, 'user', speechResult).catch(err => console.error('Error adding conversation:', err));
    
    // STEP 2: Check if we're awaiting a complete menu and this speech continues it
    if (callState.awaitingCompleteMenu) {
      console.log('📋 Checking if speech continues incomplete menu...');
      const isContinuingMenu = ivrDetector.isIVRMenu(speechResult) || 
                               /\b(for|press|select|choose)\s*\d+/i.test(speechResult) ||
                               /\b\d+\s+(for|to|press)/i.test(speechResult);
      
      if (isContinuingMenu) {
        console.log('✅ Speech continues menu - merging options...');
        // This will be handled in the IVR menu detection below
      } else {
        // Not a menu continuation - clear the awaiting flag and continue normally
        console.log('⚠️ Speech does not continue menu - clearing awaiting flag');
        callStateManager.updateCallState(callSid, {
          awaitingCompleteMenu: false,
          partialMenuOptions: []
        });
      }
    }
    
    // STEP 2: Check for IVR menu
    const isIVRMenu = ivrDetector.isIVRMenu(speechResult);
    
    if (isIVRMenu || callState.awaitingCompleteMenu) {
      console.log('📋 IVR Menu detected');
      const menuOptions = ivrDetector.extractMenuOptions(speechResult);
      
      // Check if menu appears incomplete
      const isIncomplete = ivrDetector.isIncompleteMenu(speechResult, menuOptions);
      
      if (isIncomplete) {
        console.log('⚠️ Menu appears incomplete - waiting for complete menu...');
        console.log(`   Found only ${menuOptions.length} option(s), waiting for more...`);
        
        // Store partial menu in state
        callStateManager.updateCallState(callSid, {
          partialMenuOptions: menuOptions,
          awaitingCompleteMenu: true
        });
        
        // Record incomplete menu detection (user speech already recorded at the start)
        const menuSummary = menuOptions.length > 0 
          ? `[IVR Menu incomplete - found: ${menuOptions.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`
          : '[IVR Menu detected but no options extracted yet. Waiting for complete menu...]';
        callHistoryService.addConversation(callSid, 'system', menuSummary).catch(err => console.error('Error adding conversation:', err));
        
        // Wait silently for more speech
        const gather = response.gather({
          input: 'speech',
          language: config.aiSettings.language || 'en-US',
          speechTimeout: 'auto',
          action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`,
          method: 'POST',
          enhanced: true,
          timeout: 10,
        });
        res.type('text/xml');
        return res.send(response.toString());
      }
      
      // If we have a previous partial menu, merge it with current options
      let allMenuOptions = menuOptions;
      if (callState.partialMenuOptions && callState.partialMenuOptions.length > 0) {
        console.log('📋 Merging with previous partial menu options...');
        allMenuOptions = [...callState.partialMenuOptions, ...menuOptions];
        // Remove duplicates
        const seen = new Set();
        allMenuOptions = allMenuOptions.filter(opt => {
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
      
      // Record IVR menu in history
      callHistoryService.addIVRMenu(callSid, allMenuOptions);
      
      // Check for loops
      const loopCheck = loopDetector.detectLoop(allMenuOptions);
      if (loopCheck && loopCheck.isLoop) {
        console.log(`🔄 ${loopCheck.message} - Acting immediately`);
        // Find best option (prefer "representative" or "other")
        const bestOption = allMenuOptions.find(opt => 
          opt.option.includes('representative') || 
          opt.option.includes('agent') || 
          opt.option.includes('other') ||
          opt.option.includes('operator')
        ) || allMenuOptions[0];
        
        if (bestOption) {
          const digitToPress = bestOption.digit;
          console.log(`✅ Pressing DTMF ${digitToPress} immediately (loop detected)`);
          
          // Record DTMF press in history
          callHistoryService.addDTMF(callSid, digitToPress, 'Loop detected - immediate press').catch(err => console.error('Error adding DTMF:', err));
          
          response.pause({ length: 0.5 });
          setTimeout(async () => {
            await twilioService.sendDTMF(callSid, digitToPress);
          }, 500);
          response.redirect(`${baseUrl}/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`);
          res.type('text/xml');
          return res.send(response.toString());
        }
      }
      
      // Add options to loop detector
      allMenuOptions.forEach(opt => loopDetector.addOption(opt));
      
      callStateManager.updateCallState(callSid, {
        lastMenuOptions: allMenuOptions,
        menuLevel: (callState.menuLevel || 0) + 1
      });
      
      // Use AI to decide which option to press
      console.log('🤖 Using AI to select best option...');
      const aiDecision = await aiDTMFService.understandCallPurposeAndPressDTMF(
        speechResult, 
        { callPurpose: config.callPurpose, ivrKeywords: [] }, 
        allMenuOptions
      );
      
      let digitToPress = null;
      if (aiDecision.shouldPress && aiDecision.digit) {
        digitToPress = aiDecision.digit;
        console.log(`✅ AI selected: Press ${digitToPress} (${aiDecision.matchedOption})`);
      } else {
        // Fallback: prefer options that might lead to a representative
        // Priority order:
        // 1. Options with "representative", "agent", "operator", "customer service", "support"
        // 2. Options with "technical support" or "help" (more likely to have humans)
        // 3. Options with "other" or "all other" (catch-all)
        // 4. Don't select if none match - wait for better options
        
        const repOption = allMenuOptions.find(opt => 
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
          // Try technical support or help options
          const supportOption = allMenuOptions.find(opt => 
            opt.option.includes('technical support') ||
            opt.option.includes('support') ||
            opt.option.includes('help') ||
            opt.option.includes('assistance')
          );
          
          if (supportOption) {
            digitToPress = supportOption.digit;
            console.log(`✅ Selected support option: Press ${digitToPress} (${supportOption.option})`);
          } else {
            // Try "other" or "all other" options
            const otherOption = allMenuOptions.find(opt => 
              opt.option.includes('other') ||
              opt.option.includes('all other') ||
              opt.option.includes('additional')
            );
            
            if (otherOption) {
              digitToPress = otherOption.digit;
              console.log(`✅ Selected "other" option: Press ${digitToPress} (${otherOption.option})`);
            } else {
              // No good match - wait silently for more options or better menu
              console.log('⚠️ No suitable option found for "speak with a representative" - waiting silently');
              // Record that no suitable option was found (user speech already recorded at the start)
              callHistoryService.addConversation(callSid, 'system', '[No suitable option found - waiting silently]').catch(err => console.error('Error adding conversation:', err));
              digitToPress = null;
            }
          }
        }
      }
      
      if (digitToPress) {
        // Wait for silence (2 seconds) before pressing, unless loop was detected
        console.log(`⏳ Waiting for silence before pressing ${digitToPress}...`);
        
        // Record DTMF press in history
        const reason = aiDecision && aiDecision.matchedOption 
          ? `AI selected: ${aiDecision.matchedOption}` 
          : 'Selected best option';
        callHistoryService.addDTMF(callSid, digitToPress, reason).catch(err => console.error('Error adding DTMF:', err));
        
        response.pause({ length: 2 });
        setTimeout(async () => {
          await twilioService.sendDTMF(callSid, digitToPress);
        }, 2000);
        response.redirect(`${baseUrl}/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`);
        res.type('text/xml');
        return res.send(response.toString());
      } else {
        // No option found - wait silently
        console.log('⚠️ No matching option found - waiting silently');
        // Record that no matching option was found (user speech already recorded at the start)
        callHistoryService.addConversation(callSid, 'system', '[No matching option found - waiting silently]').catch(err => console.error('Error adding conversation:', err));
        const gather = response.gather({
          input: 'speech',
          language: config.aiSettings.language || 'en-US',
          speechTimeout: 'auto',
          action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`,
          method: 'POST',
          enhanced: true,
          timeout: 10,
        });
        res.type('text/xml');
        return res.send(response.toString());
      }
    }
    
    // STEP 3: Check for transfer request (human detected)
    if (transferDetector.wantsTransfer(speechResult)) {
      console.log('🔄 Transfer request detected');
      
      // Check if we need to confirm human first
      const needsConfirmation = !callState.humanConfirmed;
      if (needsConfirmation) {
        console.log('❓ Confirming human before transfer...');
        response.say({ voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' }, 'Am I speaking with a real person or is this the automated system?');
        callStateManager.updateCallState(callSid, { awaitingHumanConfirmation: true });
        const gather = response.gather({
          input: 'speech',
          language: config.aiSettings.language || 'en-US',
          speechTimeout: 'auto',
          action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`,
          method: 'POST',
          enhanced: true,
          timeout: 10,
        });
        res.type('text/xml');
        return res.send(response.toString());
      }
      
      // Human confirmed - transfer
      console.log(`🔄 Transferring to ${config.transferNumber}`);
      
      // Record transfer in history
      callHistoryService.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
      
      response.say({ voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' }, 'Hold on, please.');
      response.pause({ length: 1 });
      
      const dial = response.dial({
        action: `${baseUrl}/transfer-status`,
        method: 'POST',
        timeout: 30,
        answerOnMedia: true,
      });
      dial.number(config.transferNumber);
      
      res.type('text/xml');
      return res.send(response.toString());
    }
    
    // STEP 4: Check if awaiting human confirmation OR detect human confirmation directly
    const isHumanConfirmation = /(?:yes|yeah|correct|right|real person|human|yes i am|yes this is|yes you are|talking to a real person|speaking with a real person)/i.test(speechResult);
    
    if (callState.awaitingHumanConfirmation || isHumanConfirmation) {
      if (isHumanConfirmation) {
        console.log('✅ Human confirmed - transferring');
        callStateManager.updateCallState(callSid, { humanConfirmed: true, awaitingHumanConfirmation: false });
        
        // Record transfer in history
        callHistoryService.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
        
        response.say({ voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' }, 'Thank you. Hold on, please.');
        response.pause({ length: 1 });
        
        const dial = response.dial({
          action: `${baseUrl}/transfer-status`,
          method: 'POST',
          timeout: 30,
          answerOnMedia: true,
        });
        dial.number(config.transferNumber);
        
        res.type('text/xml');
        return res.send(response.toString());
      }
    }
    
    // Also check if transfer phrases are detected (even without explicit confirmation)
    if (transferDetector.wantsTransfer(speechResult) && callState.humanConfirmed) {
      console.log('🔄 Transfer phrase detected and human already confirmed - transferring immediately');
      
      // Record transfer in history
      callHistoryService.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
      
      response.say({ voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' }, 'Hold on, please.');
      response.pause({ length: 1 });
      
      const dial = response.dial({
        action: `${baseUrl}/transfer-status`,
        method: 'POST',
        timeout: 30,
        answerOnMedia: true,
      });
      dial.number(config.transferNumber);
      
      res.type('text/xml');
      return res.send(response.toString());
    }
    
    // STEP 5: Generate AI response for regular conversation
    // Skip AI response if we're still awaiting a complete menu
    if (callState.awaitingCompleteMenu) {
      console.log('⚠️ Still awaiting complete menu - remaining silent, waiting for more options');
      // Record that we're waiting silently (user speech already recorded above)
      callHistoryService.addConversation(callSid, 'system', '[Waiting for complete menu - remaining silent]').catch(err => console.error('Error adding conversation:', err));
      // Wait silently for more menu options
      const gather = response.gather({
        input: 'speech',
        language: config.aiSettings.language || 'en-US',
        speechTimeout: 'auto',
        action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`,
        method: 'POST',
        enhanced: true,
        timeout: 10,
      });
      res.type('text/xml');
      return res.send(response.toString());
    }
    
    const conversationHistory = callState.conversationHistory || [];
    const aiResponse = await aiService.generateResponse(
      config,
      speechResult,
      isFirstCall,
      conversationHistory.map(h => h.text || h)
    );
    
    console.log('OpenAI response:', aiResponse);
    
    // Add to conversation history (callStateManager)
    callStateManager.addToHistory(callSid, {
      type: 'system',
      text: speechResult
    });
    
    // Only add AI response if it's not "Silent" or empty
    if (aiResponse && aiResponse.trim().toLowerCase() !== 'silent' && aiResponse.trim().length > 0) {
      callStateManager.addToHistory(callSid, {
        type: 'ai',
        text: aiResponse
      });
      
      // Add AI response to call history service (user speech already recorded at the start)
      callHistoryService.addConversation(callSid, 'ai', aiResponse).catch(err => console.error('Error adding conversation:', err));
      
      // Respond
      response.say({ voice: config.aiSettings.voice || 'Polly.Matthew', language: config.aiSettings.language || 'en-US' }, aiResponse);
    } else {
      console.log('🤫 AI chose to remain silent - not speaking');
      // Record that AI remained silent (user speech already recorded at the start)
      callHistoryService.addConversation(callSid, 'system', '[AI remained silent]').catch(err => console.error('Error adding conversation:', err));
    }
    
    const gather = response.gather({
      input: 'speech',
      language: config.aiSettings.language || 'en-US',
      speechTimeout: 'auto',
      action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`,
      method: 'POST',
      enhanced: true,
      timeout: 10,
    });
    
    res.type('text/xml');
    res.send(response.toString());
    
  } catch (error) {
    console.error('❌ Error in /process-speech:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
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
router.post('/process-dtmf', (req, res) => {
  const callSid = req.body.CallSid;
  const digits = req.body.Digits || req.query.Digits;
  const baseUrl = getBaseUrl(req);
  
  // Get transfer config
  const config = transferConfig.createConfig({
    transferNumber: req.query.transferNumber || process.env.TRANSFER_PHONE_NUMBER,
    callPurpose: req.query.callPurpose || 'speak with a representative'
  });
  
  console.log('🔢 DTMF processed:', digits);
  
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: 'speech',
    language: config.aiSettings.language || 'en-US',
    speechTimeout: 'auto',
    action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose)}`,
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
router.post('/transfer-status', (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  console.log('🔄 Transfer status:', callStatus);
  
  // Update call history
  if (callStatus === 'completed' || callStatus === 'failed') {
    callHistoryService.endCall(callSid, callStatus).catch(err => console.error('Error ending call:', err));
  }
  
  const response = new twilio.twiml.VoiceResponse();
  res.type('text/xml');
  res.send(response.toString());
});

module.exports = router;
