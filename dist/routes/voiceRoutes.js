"use strict";
/**
 * Voice Routes - Transfer-Only Mode
 * Handles Twilio voice webhooks for transfer-only phone navigation
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const twilio_1 = __importDefault(require("twilio"));
const transfer_config_1 = __importDefault(require("../config/transfer-config"));
const callStateManager_1 = __importDefault(require("../services/callStateManager"));
const callHistoryService_1 = __importDefault(require("../services/callHistoryService"));
const ivrDetector = __importStar(require("../utils/ivrDetector"));
const transferDetector = __importStar(require("../utils/transferDetector"));
const terminationDetector = __importStar(require("../utils/terminationDetector"));
const loopDetector_1 = require("../utils/loopDetector");
const aiService_1 = __importDefault(require("../services/aiService"));
const aiDTMFService_1 = __importDefault(require("../services/aiDTMFService"));
const twilioService_1 = __importDefault(require("../services/twilioService"));
const router = express_1.default.Router();
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
        const config = transfer_config_1.default.createConfig({
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
        callStateManager_1.default.updateCallState(callSid, {
            transferConfig: config,
            loopDetector: new loopDetector_1.LoopDetector(),
            holdStartTime: null
        });
        callHistoryService_1.default.startCall(callSid, {
            to: req.body.To || req.body.Called,
            from: req.body.From || req.body.Caller,
            transferNumber: config.transferNumber,
            callPurpose: config.callPurpose,
            customInstructions: config.customInstructions
        }).catch(err => console.error('Error starting call history:', err));
        const response = new twilio_1.default.twiml.VoiceResponse();
        response.gather({
            input: ['speech'],
            language: (config.aiSettings.language || 'en-US'),
            speechTimeout: 'auto',
            action: `${baseUrl}/process-speech?firstCall=true&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}${config.customInstructions ? '&customInstructions=' + encodeURIComponent(config.customInstructions) : ''}`,
            method: 'POST',
            enhanced: true,
            timeout: 10,
        });
        response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, 'Thank you. Goodbye.');
        response.hangup();
        res.type('text/xml');
        res.send(response.toString());
        return;
    }
    catch (error) {
        console.error('❌ Error in /voice endpoint:', error);
        const response = new twilio_1.default.twiml.VoiceResponse();
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
    const response = new twilio_1.default.twiml.VoiceResponse();
    try {
        const callSid = req.body.CallSid;
        const speechResult = req.body.SpeechResult || '';
        const isFirstCall = req.query.firstCall === 'true';
        const baseUrl = getBaseUrl(req);
        const config = transfer_config_1.default.createConfig({
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
        const callState = callStateManager_1.default.getCallState(callSid);
        if (!callState.loopDetector) {
            callStateManager_1.default.updateCallState(callSid, { loopDetector: new loopDetector_1.LoopDetector() });
        }
        const loopDetector = callState.loopDetector;
        const previousSpeech = callState.lastSpeech || '';
        const termination = terminationDetector.shouldTerminate(speechResult, previousSpeech, 0);
        if (termination.shouldTerminate) {
            console.log(`🛑 ${termination.message}`);
            callHistoryService_1.default.addTermination(callSid, termination.reason || termination.message || '').catch(err => console.error('Error adding termination:', err));
            callHistoryService_1.default.endCall(callSid, 'terminated').catch(err => console.error('Error ending call:', err));
            response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, 'Thank you. Goodbye.');
            response.hangup();
            callStateManager_1.default.clearCallState(callSid);
            res.type('text/xml');
            res.send(response.toString());
            return;
        }
        callStateManager_1.default.updateCallState(callSid, { lastSpeech: speechResult });
        callHistoryService_1.default.addConversation(callSid, 'user', speechResult).catch(err => console.error('Error adding conversation:', err));
        if (callState.awaitingCompleteMenu) {
            console.log('📋 Checking if speech continues incomplete menu...');
            const isContinuingMenu = ivrDetector.isIVRMenu(speechResult) ||
                /\b(for|press|select|choose)\s*\d+/i.test(speechResult) ||
                /\b\d+\s+(for|to|press)/i.test(speechResult);
            if (isContinuingMenu) {
                console.log('✅ Speech continues menu - merging options...');
            }
            else {
                console.log('⚠️ Speech does not continue menu - clearing awaiting flag');
                callStateManager_1.default.updateCallState(callSid, {
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
                callStateManager_1.default.updateCallState(callSid, {
                    partialMenuOptions: menuOptions,
                    awaitingCompleteMenu: true
                });
                const menuSummary = menuOptions.length > 0
                    ? `[IVR Menu incomplete - found: ${menuOptions.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`
                    : '[IVR Menu detected but no options extracted yet. Waiting for complete menu...]';
                callHistoryService_1.default.addConversation(callSid, 'system', menuSummary).catch(err => console.error('Error adding conversation:', err));
                response.gather({
                    input: ['speech'],
                    language: (config.aiSettings.language || 'en-US'),
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
                const seen = new Set();
                allMenuOptions = allMenuOptions.filter(opt => {
                    const key = `${opt.digit}-${opt.option}`;
                    if (seen.has(key))
                        return false;
                    seen.add(key);
                    return true;
                });
                callStateManager_1.default.updateCallState(callSid, {
                    partialMenuOptions: [],
                    awaitingCompleteMenu: false
                });
            }
            callHistoryService_1.default.addIVRMenu(callSid, allMenuOptions);
            const loopCheck = loopDetector.detectLoop(allMenuOptions);
            if (loopCheck && loopCheck.isLoop) {
                console.log(`🔄 ${loopCheck.message} - Acting immediately`);
                const bestOption = allMenuOptions.find(opt => opt.option.includes('representative') ||
                    opt.option.includes('agent') ||
                    opt.option.includes('other') ||
                    opt.option.includes('operator')) || allMenuOptions[0];
                if (bestOption) {
                    const digitToPress = bestOption.digit;
                    console.log(`✅ Pressing DTMF ${digitToPress} immediately (loop detected)`);
                    callHistoryService_1.default.addDTMF(callSid, digitToPress, 'Loop detected - immediate press').catch(err => console.error('Error adding DTMF:', err));
                    response.pause({ length: 0.5 });
                    setTimeout(async () => {
                        await twilioService_1.default.sendDTMF(callSid, digitToPress);
                    }, 500);
                    response.redirect(`${baseUrl}/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`);
                    res.type('text/xml');
                    res.send(response.toString());
                    return;
                }
            }
            allMenuOptions.forEach(opt => loopDetector.addOption(opt));
            callStateManager_1.default.updateCallState(callSid, {
                lastMenuOptions: allMenuOptions,
                menuLevel: (callState.menuLevel || 0) + 1
            });
            console.log('🤖 Using AI to select best option...');
            const aiDecision = await aiDTMFService_1.default.understandCallPurposeAndPressDTMF(speechResult, { callPurpose: config.callPurpose }, allMenuOptions);
            let digitToPress = null;
            if (aiDecision.shouldPress && aiDecision.digit) {
                digitToPress = aiDecision.digit;
                console.log(`✅ AI selected: Press ${digitToPress} (${aiDecision.matchedOption})`);
            }
            else {
                const repOption = allMenuOptions.find(opt => opt.option.includes('representative') ||
                    opt.option.includes('agent') ||
                    opt.option.includes('operator') ||
                    opt.option.includes('customer service') ||
                    opt.option.includes('speak to'));
                if (repOption) {
                    digitToPress = repOption.digit;
                    console.log(`✅ Selected representative option: Press ${digitToPress} (${repOption.option})`);
                }
                else {
                    const supportOption = allMenuOptions.find(opt => opt.option.includes('technical support') ||
                        opt.option.includes('support') ||
                        opt.option.includes('help') ||
                        opt.option.includes('assistance'));
                    if (supportOption) {
                        digitToPress = supportOption.digit;
                        console.log(`✅ Selected support option: Press ${digitToPress} (${supportOption.option})`);
                    }
                    else {
                        const otherOption = allMenuOptions.find(opt => opt.option.includes('other') ||
                            opt.option.includes('all other') ||
                            opt.option.includes('additional'));
                        if (otherOption) {
                            digitToPress = otherOption.digit;
                            console.log(`✅ Selected "other" option: Press ${digitToPress} (${otherOption.option})`);
                        }
                        else {
                            console.log('⚠️ No suitable option found for "speak with a representative" - waiting silently');
                            callHistoryService_1.default.addConversation(callSid, 'system', '[No suitable option found - waiting silently]').catch(err => console.error('Error adding conversation:', err));
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
                callHistoryService_1.default.addDTMF(callSid, digitToPress, reason).catch(err => console.error('Error adding DTMF:', err));
                response.pause({ length: 2 });
                setTimeout(async () => {
                    await twilioService_1.default.sendDTMF(callSid, digitToPress);
                }, 2000);
                response.redirect(`${baseUrl}/process-dtmf?Digits=${digitToPress}&transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`);
                res.type('text/xml');
                res.send(response.toString());
                return;
            }
            else {
                console.log('⚠️ No matching option found - waiting silently');
                callHistoryService_1.default.addConversation(callSid, 'system', '[No matching option found - waiting silently]').catch(err => console.error('Error adding conversation:', err));
                response.gather({
                    input: ['speech'],
                    language: (config.aiSettings.language || 'en-US'),
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
                response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, 'Am I speaking with a real person or is this the automated system?');
                callStateManager_1.default.updateCallState(callSid, { awaitingHumanConfirmation: true });
                response.gather({
                    input: ['speech'],
                    language: (config.aiSettings.language || 'en-US'),
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
            callHistoryService_1.default.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
            response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, 'Hold on, please.');
            response.pause({ length: 1 });
            const dial = response.dial({
                action: `${baseUrl}/transfer-status`,
                method: 'POST',
                timeout: 30,
            });
            dial.answerOnMedia = true;
            dial.number(config.transferNumber);
            res.type('text/xml');
            res.send(response.toString());
            return;
        }
        const isHumanConfirmation = /(?:yes|yeah|correct|right|real person|human|yes i am|yes this is|yes you are|talking to a real person|speaking with a real person)/i.test(speechResult);
        if (callState.awaitingHumanConfirmation || isHumanConfirmation) {
            if (isHumanConfirmation) {
                console.log('✅ Human confirmed - transferring');
                callStateManager_1.default.updateCallState(callSid, { humanConfirmed: true, awaitingHumanConfirmation: false });
                callHistoryService_1.default.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
                response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, 'Thank you. Hold on, please.');
                response.pause({ length: 1 });
                const dial = response.dial({
                    action: `${baseUrl}/transfer-status`,
                    method: 'POST',
                    timeout: 30,
                });
                dial.answerOnMedia = true;
                dial.number(config.transferNumber);
                res.type('text/xml');
                res.send(response.toString());
                return;
            }
        }
        if (transferDetector.wantsTransfer(speechResult) && callState.humanConfirmed) {
            console.log('🔄 Transfer phrase detected and human already confirmed - transferring immediately');
            callHistoryService_1.default.addTransfer(callSid, config.transferNumber, true).catch(err => console.error('Error adding transfer:', err));
            response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, 'Hold on, please.');
            response.pause({ length: 1 });
            const dial = response.dial({
                action: `${baseUrl}/transfer-status`,
                method: 'POST',
                timeout: 30,
            });
            dial.answerOnMedia = true;
            dial.number(config.transferNumber);
            res.type('text/xml');
            res.send(response.toString());
            return;
        }
        if (callState.awaitingCompleteMenu) {
            console.log('⚠️ Still awaiting complete menu - remaining silent, waiting for more options');
            callHistoryService_1.default.addConversation(callSid, 'system', '[Waiting for complete menu - remaining silent]').catch(err => console.error('Error adding conversation:', err));
            response.gather({
                input: ['speech'],
                language: (config.aiSettings.language || 'en-US'),
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
        const aiResponse = await aiService_1.default.generateResponse(config, speechResult, isFirstCall, conversationHistory.map(h => ({ type: h.type, text: h.text || '' })));
        console.log('OpenAI response:', aiResponse);
        callStateManager_1.default.addToHistory(callSid, {
            type: 'system',
            text: speechResult
        });
        if (aiResponse && aiResponse.trim().toLowerCase() !== 'silent' && aiResponse.trim().length > 0) {
            callStateManager_1.default.addToHistory(callSid, {
                type: 'ai',
                text: aiResponse
            });
            callHistoryService_1.default.addConversation(callSid, 'ai', aiResponse).catch(err => console.error('Error adding conversation:', err));
            response.say({ voice: (config.aiSettings.voice || 'Polly.Matthew'), language: (config.aiSettings.language || 'en-US') }, aiResponse);
        }
        else {
            console.log('🤫 AI chose to remain silent - not speaking');
            callHistoryService_1.default.addConversation(callSid, 'system', '[AI remained silent]').catch(err => console.error('Error adding conversation:', err));
        }
        response.gather({
            input: ['speech'],
            language: (config.aiSettings.language || 'en-US'),
            speechTimeout: 'auto',
            action: `${baseUrl}/process-speech?transferNumber=${encodeURIComponent(config.transferNumber)}&callPurpose=${encodeURIComponent(config.callPurpose || '')}`,
            method: 'POST',
            enhanced: true,
            timeout: 10,
        });
        res.type('text/xml');
        res.send(response.toString());
    }
    catch (error) {
        console.error('❌ Error in /process-speech:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('Call SID:', req.body.CallSid);
        console.error('Speech Result:', req.body.SpeechResult);
        console.error('Query params:', req.query);
        const errorResponse = new twilio_1.default.twiml.VoiceResponse();
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
    const digits = req.body.Digits || req.query.Digits;
    const baseUrl = getBaseUrl(req);
    const config = transfer_config_1.default.createConfig({
        transferNumber: req.query.transferNumber || process.env.TRANSFER_PHONE_NUMBER,
        callPurpose: req.query.callPurpose || 'speak with a representative'
    });
    console.log('🔢 DTMF processed:', digits);
    const response = new twilio_1.default.twiml.VoiceResponse();
    response.gather({
        input: ['speech'],
        language: (config.aiSettings.language || 'en-US'),
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
router.post('/transfer-status', (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;
    console.log('🔄 Transfer status:', callStatus);
    if ((callStatus === 'completed' || callStatus === 'failed') && callSid) {
        callHistoryService_1.default.endCall(callSid, callStatus).catch(err => console.error('Error ending call:', err));
    }
    const response = new twilio_1.default.twiml.VoiceResponse();
    res.type('text/xml');
    res.send(response.toString());
});
exports.default = router;
//# sourceMappingURL=voiceRoutes.js.map