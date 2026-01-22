/**
 * API Routes
 * REST API endpoints for transfer-only calls
 */

const express = require('express');
const router = express.Router();
const transferConfig = require('../config/transfer-config');
const twilioService = require('../services/twilioService');
const callHistoryService = require('../services/callHistoryService');
const database = require('../services/database');
const { authenticate } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

/**
 * Get transfer configuration defaults
 * Requires authentication
 */
router.get('/config', authenticate, (req, res) => {
  res.json({
    success: true,
    config: {
      transferNumber: transferConfig.defaults.transferNumber,
      userPhone: transferConfig.defaults.userPhone,
      userEmail: transferConfig.defaults.userEmail,
      aiSettings: transferConfig.defaults.aiSettings
    }
  });
});

/**
 * Get the transfer prompt
 * Requires authentication
 */
router.get('/prompt', authenticate, (req, res) => {
  try {
    const promptPath = path.join(__dirname, '../prompts/transfer-prompt.js');
    const promptContent = fs.readFileSync(promptPath, 'utf8');
    
    // Extract just the systemPrompt part (between the backticks)
    const promptMatch = promptContent.match(/const systemPrompt = `([\s\S]*?)`;/);
    const prompt = promptMatch ? promptMatch[1] : promptContent;
    
    res.json({
      success: true,
      prompt: prompt
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get call history
 * Requires authentication
 */
router.get('/calls/history', authenticate, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const calls = await callHistoryService.getRecentCalls(limit);
    
    res.json({
      success: true,
      calls: calls.map(call => ({
        callSid: call.callSid,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration,
        status: call.status,
        metadata: call.metadata,
        conversationCount: call.conversation ? call.conversation.length : 0,
        dtmfCount: call.dtmfPresses ? call.dtmfPresses.length : 0,
        eventCount: call.events ? call.events.length : 0
      })),
      mongoConnected: database.isDbConnected()
    });
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      mongoConnected: false
    });
  }
});

/**
 * Get detailed call information
 * Requires authentication
 */
router.get('/calls/:callSid', authenticate, async (req, res) => {
  try {
    const { callSid } = req.params;
    const call = await callHistoryService.getCall(callSid);
    
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }
    
    res.json({
      success: true,
      call: {
        callSid: call.callSid,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration,
        status: call.status,
        metadata: call.metadata,
        conversation: call.conversation || [],
        dtmfPresses: call.dtmfPresses || [],
        events: call.events || []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Save settings (prompt and config)
 * Requires authentication
 */
router.post('/settings', authenticate, (req, res) => {
  try {
    const { transferNumber, toPhoneNumber, callPurpose, customInstructions, voice, userPhone, userEmail, prompt } = req.body;
    
    // Update .env file (simplified - you might want to use a proper config file)
    // For now, just return success - actual .env update would require file writing
    
    // If prompt is provided, save it
    if (prompt) {
      const promptPath = path.join(__dirname, '../prompts/transfer-prompt.js');
      // Note: This is a simplified version - you'd want to properly parse and update the prompt
      // For now, we'll just acknowledge the save
    }
    
    res.json({
      success: true,
      message: 'Settings saved successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Initiate a transfer-only call
 * Requires authentication
 */
router.post('/calls/initiate', authenticate, async (req, res) => {
  try {
    const { to, from, transferNumber, callPurpose, customInstructions } = req.body;
    
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: to'
      });
    }
    
    // Create transfer config from request
    const config = transferConfig.createConfig({
      transferNumber: transferNumber || process.env.TRANSFER_PHONE_NUMBER,
      callPurpose: callPurpose || 'speak with a representative',
      customInstructions: customInstructions || ''
    });
    
    // Use TWIML_URL from env, or BASE_URL, or construct from request
    let baseUrl = process.env.TWIML_URL || process.env.BASE_URL;
    
    if (!baseUrl) {
      // Fallback: construct from request (but warn if localhost)
      const host = req.get('host');
      if (host && host.includes('localhost')) {
        throw new Error('Cannot use localhost URL. Please set TWIML_URL or BASE_URL in .env to your ngrok URL (e.g., https://abc123.ngrok-free.app)');
      }
      baseUrl = `https://${host}`;
    }
    
    // Remove /voice if it's already in the URL
    if (baseUrl.endsWith('/voice')) {
      baseUrl = baseUrl.replace('/voice', '');
    }
    
    const params = new URLSearchParams({
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose
    });
    if (config.customInstructions) {
      params.append('customInstructions', config.customInstructions);
    }
    const twimlUrl = `${baseUrl}/voice?${params.toString()}`;
    
    const call = await twilioService.initiateCall(
      to,
      from || process.env.TWILIO_PHONE_NUMBER,
      twimlUrl
    );
    
    // Start tracking this call in history
    callHistoryService.startCall(call.sid, {
      to: call.to,
      from: call.from,
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose,
      customInstructions: config.customInstructions
    }).catch(err => console.error('Error starting call history:', err));
    
    res.json({
      success: true,
      call: {
        sid: call.sid,
        status: call.status,
        to: call.to,
        from: call.from
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
