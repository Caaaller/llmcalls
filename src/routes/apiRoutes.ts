/**
 * API Routes
 * REST API endpoints for transfer-only calls
 */

import express, { Request, Response } from 'express';
import transferConfig from '../config/transfer-config';
import twilioService from '../services/twilioService';
import callHistoryService from '../services/callHistoryService';
import { isDbConnected } from '../services/database';
import { authenticate } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

const router = express.Router();

/**
 * Get transfer configuration defaults
 */
router.get('/config', authenticate, (_req: Request, res: Response) => {
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
 */
router.get('/prompt', authenticate, (_req: Request, res: Response) => {
  try {
    // Read from source TypeScript file using process.cwd() for reliable path resolution
    const promptPath = path.join(process.cwd(), 'src/prompts/transfer-prompt.ts');
    const promptContent = fs.readFileSync(promptPath, 'utf8');
    
    const promptMatch = promptContent.match(/const systemPrompt = `([\s\S]*?)`;/);
    const prompt = promptMatch ? promptMatch[1] : promptContent;
    
    res.json({
      success: true,
      prompt: prompt
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: `Failed to load prompt: ${errorMessage}. Path attempted: ${path.join(process.cwd(), 'src/prompts/transfer-prompt.ts')}`
    });
  }
});

/**
 * Get call history
 */
router.get('/calls/history', authenticate, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const calls = await callHistoryService.getRecentCalls(limit);
    
    res.json({
      success: true,
      calls: calls.map((call) => ({
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
      mongoConnected: isDbConnected()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error fetching call history:', error);
    res.status(500).json({
      success: false,
      error: errorMessage,
      mongoConnected: false
    });
  }
});

/**
 * Get detailed call information
 */
router.get('/calls/:callSid', authenticate, async (req: Request, res: Response) => {
  try {
    const { callSid } = req.params;
    const call = await callHistoryService.getCall(callSid as string);
    
    if (!call) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }
    
    return res.json({
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
    return;
  }
});

/**
 * Save settings
 */
router.post('/settings', authenticate, (_req: Request, res: Response): void => {
  res.json({
    success: true,
    message: 'Settings saved successfully'
  });
});

/**
 * Initiate a transfer-only call
 */
router.post('/calls/initiate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, from, transferNumber, callPurpose, customInstructions } = req.body;
    
    if (!to) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: to'
      });
      return;
    }
    
    const config = transferConfig.createConfig({
      transferNumber: transferNumber || process.env.TRANSFER_PHONE_NUMBER,
      callPurpose: callPurpose || process.env.CALL_PURPOSE || 'speak with a representative',
      customInstructions: customInstructions || ''
    });
    
    let baseUrl = process.env.TWIML_URL || process.env.BASE_URL;
    
    if (!baseUrl) {
      const host = req.get('host');
      if (host && host.includes('localhost')) {
        res.status(500).json({
          success: false,
          error: 'Cannot use localhost URL. Please set TWIML_URL or BASE_URL in .env to your ngrok URL (e.g., https://abc123.ngrok-free.app)'
        });
        return;
      }
      baseUrl = `https://${host}`;
    }
    
    if (baseUrl.endsWith('/voice')) {
      baseUrl = baseUrl.replace('/voice', '');
    }
    
    const params = new URLSearchParams({
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose || 'speak with a representative'
    });
    if (config.customInstructions) {
      params.append('customInstructions', config.customInstructions);
    }
    const twimlUrl = `${baseUrl}/voice?${params.toString()}`;
    
    const call = await twilioService.initiateCall(
      to,
      from || process.env.TWILIO_PHONE_NUMBER || '',
      twimlUrl
    );
    
    await callHistoryService.startCall(call.sid, {
      to: call.to,
      from: call.from,
      transferNumber: config.transferNumber,
      callPurpose: config.callPurpose,
      customInstructions: config.customInstructions
    });
    
    res.json({
      success: true,
      call: {
        sid: call.sid,
        status: call.status,
        to: call.to,
        from: call.from
      }
    });
    return;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage
    });
    return;
  }
});

export default router;

