/**
 * API Routes
 * REST API endpoints for transfer-only calls
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { validatedRoute } from '../middleware/validateQuery';
import transferConfig from '../config/transfer-config';
import telnyxService from '../services/telnyxService';
import { encodeClientState } from '../types/telnyx';
import callHistoryService from '../services/callHistoryService';
import callStateManager from '../services/callStateManager';
import evaluationService from '../services/evaluationService';
import { isDbConnected } from '../services/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import SavedCall from '../models/SavedCall';
import TestCaseOverride from '../models/TestCaseOverride';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

const router: express.Router = express.Router();

function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+') && digits.length >= 7) return `+${digits}`;
  return null;
}

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
      aiSettings: transferConfig.defaults.aiSettings,
    },
  });
});

/**
 * Get the transfer prompt
 */
router.get('/prompt', authenticate, (_req: Request, res: Response) => {
  try {
    // Read from source TypeScript file using process.cwd() for reliable path resolution
    const promptPath = path.join(
      process.cwd(),
      'src/prompts/transfer-prompt.ts'
    );
    const promptContent = fs.readFileSync(promptPath, 'utf8');

    const promptMatch = promptContent.match(
      /const systemPrompt = `([\s\S]*?)`;/
    );
    const prompt = promptMatch ? promptMatch[1] : promptContent;

    res.json({
      success: true,
      prompt: prompt,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: `Failed to load prompt: ${errorMessage}. Path attempted: ${path.join(process.cwd(), 'src/prompts/transfer-prompt.ts')}`,
    });
  }
});

/**
 * Get call history
 */
router.get(
  '/calls/history',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const limit = parseInt(req.query.limit as string) || 50;
      const userId = authReq.user?._id?.toString();
      const calls = await callHistoryService.getRecentCalls(limit, userId);

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
          eventCount: call.events ? call.events.length : 0,
          recordingUrl: call.recordingUrl ?? undefined,
        })),
        mongoConnected: isDbConnected(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
        mongoConnected: false,
      });
    }
  }
);

/**
 * Get detailed call information
 */
router.get(
  '/calls/:callSid',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { callSid } = req.params;
      const call = await callHistoryService.getCall(callSid as string);

      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Call not found',
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
          events: call.events || [],
          recordingUrl: call.recordingUrl ?? undefined,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
      return;
    }
  }
);

/**
 * Stream call recording (proxy with Twilio auth so the browser can play it)
 */
router.get(
  '/calls/:callSid/recording',
  authenticate,
  async (req: Request, res: Response) => {
    const { callSid } = req.params;
    const call = await callHistoryService.getCall(callSid as string);
    if (!call?.recordingUrl) {
      return res.status(404).json({
        success: false,
        error: 'Call or recording not found',
      });
    }
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        error: 'Recording proxy not configured',
      });
    }

    // Resolve recording URL — stored as "telnyx:<recording_id>" or a direct URL
    let downloadUrl = call.recordingUrl;
    if (downloadUrl.startsWith('telnyx:')) {
      const recordingId = downloadUrl.replace('telnyx:', '');
      const telnyxRes = await fetch(
        `https://api.telnyx.com/v2/recordings/${recordingId}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!telnyxRes.ok) {
        return res.status(502).json({
          success: false,
          error: 'Failed to fetch recording metadata from Telnyx',
        });
      }
      const telnyxData = (await telnyxRes.json()) as {
        data: { download_urls: { mp3: string } };
      };
      downloadUrl = telnyxData.data.download_urls.mp3;
    }

    const recordingResponse = await fetch(downloadUrl);
    if (!recordingResponse.ok) {
      return res.status(recordingResponse.status).json({
        success: false,
        error: 'Failed to fetch recording from Telnyx',
      });
    }
    const contentType =
      recordingResponse.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    const arrayBuffer = await recordingResponse.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      return res.status(502).json({
        success: false,
        error: 'No recording body',
      });
    }
    return res.send(Buffer.from(arrayBuffer));
  }
);

/**
 * Save settings
 */
router.post('/settings', authenticate, (_req: Request, res: Response): void => {
  res.json({
    success: true,
    message: 'Settings saved successfully',
  });
});

/**
 * Initiate a transfer-only call
 */
router.post(
  '/calls/initiate',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const {
        to,
        from,
        transferNumber,
        callPurpose,
        customInstructions,
        userPhone,
        skipInfoRequests,
      } = req.body;

      if (!to) {
        res.status(400).json({
          success: false,
          error: 'Missing required field: to',
        });
        return;
      }

      const normalizedTo = toE164(to);
      if (!normalizedTo) {
        res.status(400).json({
          success: false,
          error: `Invalid phone number: "${to}". Please use a US number (10 digits) or E164 format (+1XXXXXXXXXX).`,
        });
        return;
      }

      const config = transferConfig.createConfig({
        transferNumber: transferNumber || process.env.TRANSFER_PHONE_NUMBER,
        callPurpose:
          callPurpose ||
          process.env.CALL_PURPOSE ||
          'speak with a representative',
        customInstructions: customInstructions || '',
      });

      console.log('📋 Resolved config:', {
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose,
        hasCustomInstructions: !!config.customInstructions,
      });

      let baseUrl = process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL;

      if (!baseUrl) {
        // Try to detect ngrok URL from request headers
        const host = req.get('host');
        const protocol = req.protocol || 'https';
        const forwardedHost = req.get('x-forwarded-host');
        const forwardedProto = req.get('x-forwarded-proto');

        // Use forwarded headers if available (ngrok sets these)
        const detectedHost = forwardedHost || host;
        const detectedProtocol = forwardedProto || protocol;

        if (detectedHost && detectedHost.includes('localhost')) {
          res.status(500).json({
            success: false,
            error:
              'Cannot use localhost URL. Please set TWIML_URL or BASE_URL in .env to your ngrok URL (e.g., https://abc123.ngrok-free.app), or access the app through ngrok.',
          });
          return;
        }

        baseUrl = `${detectedProtocol}://${detectedHost}`;
        console.log('Auto-detected base URL from request:', baseUrl);
      }

      if (baseUrl.endsWith('/voice')) {
        baseUrl = baseUrl.replace('/voice', '');
      }

      const webhookUrl = `${baseUrl}/voice`;

      const clientState = encodeClientState({
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose || 'speak with a representative',
        customInstructions: config.customInstructions || '',
        ...(userPhone && { userPhone }),
        ...(skipInfoRequests && { skipInfoRequests: true }),
      });

      const fromNumber = from || process.env.TELNYX_PHONE_NUMBER || '';

      const call = await telnyxService.initiateCall(
        normalizedTo,
        fromNumber,
        clientState,
        webhookUrl
      );

      await callHistoryService.startCall(call.sid, {
        to: normalizedTo,
        from: fromNumber,
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose,
        customInstructions: config.customInstructions,
        userId: authReq.user?._id?.toString(),
      });

      res.json({
        success: true,
        call: {
          sid: call.sid,
          status: call.status,
          to,
          from: fromNumber,
        },
      });
      return;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
      return;
    }
  }
);

/**
 * Get evaluation metrics
 * Query params:
 * - days: number of days to look back (optional)
 * - startDate: ISO date string for start date (optional)
 * - endDate: ISO date string for end date (optional)
 */
const evaluationQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((val: string | undefined) =>
      val ? parseInt(val, 10) : undefined
    )
    .refine(
      (val: number | undefined) => val === undefined || (val > 0 && val <= 365),
      {
        message: 'Days must be between 1 and 365',
      }
    ),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

router.get(
  '/evaluations',
  authenticate,
  ...validatedRoute(evaluationQuerySchema, async (req, res) => {
    try {
      if (!isDbConnected()) {
        return res.status(503).json({
          success: false,
          error: 'Database not connected',
        });
      }

      const { days, startDate, endDate } = req.validatedQuery;

      let metrics;

      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;
        metrics = await evaluationService.calculateMetrics(start, end);
      } else if (days) {
        metrics = await evaluationService.getMetricsForLastDays(days);
      } else {
        metrics = await evaluationService.getAllTimeMetrics();
      }

      return res.json({
        success: true,
        metrics,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  })
);

/**
 * Get detailed breakdown of calls
 * Query params:
 * - startDate: ISO date string for start date (optional)
 * - endDate: ISO date string for end date (optional)
 */
const breakdownQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

router.get(
  '/evaluations/breakdown',
  authenticate,
  ...validatedRoute(breakdownQuerySchema, async (req, res) => {
    try {
      if (!isDbConnected()) {
        return res.status(503).json({
          success: false,
          error: 'Database not connected',
        });
      }

      const { startDate: startDateParam, endDate: endDateParam } =
        req.validatedQuery;

      const startDate = startDateParam ? new Date(startDateParam) : undefined;
      const endDate = endDateParam ? new Date(endDateParam) : undefined;

      const breakdown = await evaluationService.getDetailedBreakdown(
        startDate,
        endDate
      );

      return res.json({
        success: true,
        breakdown,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  })
);

// ── Pending Info Request ──

/**
 * Check if a call has a pending info request
 */
router.get(
  '/calls/:callSid/pending-info',
  authenticate,
  (req: Request, res: Response) => {
    const callSid = req.params.callSid as string;
    const state = callStateManager.getCallState(callSid);
    const pending = state.pendingInfoRequest;

    if (!pending || pending.userResponse) {
      res.json({ pending: false });
      return;
    }

    res.json({
      pending: true,
      requestedInfo: pending.requestedInfo,
      requestedAt: pending.requestedAt,
    });
  }
);

/**
 * Provide info for a pending request (web UI)
 */
router.post(
  '/calls/:callSid/provide-info',
  authenticate,
  (req: Request, res: Response) => {
    const callSid = req.params.callSid as string;
    const { response: userResponse } = req.body;

    if (!userResponse || typeof userResponse !== 'string') {
      res.status(400).json({ success: false, error: 'response is required' });
      return;
    }

    const resolved = callStateManager.resolveInfoRequest(
      callSid,
      userResponse.trim(),
      'web'
    );

    if (resolved) {
      console.log(
        `🌐 Web info provided for ${callSid}: "${userResponse.trim()}"`
      );
      callHistoryService
        .addInfoResponse(callSid, userResponse.trim(), 'web')
        .catch(err => console.error('Error logging info response:', err));
    }

    res.json({ success: true, resolved });
  }
);

// ── Test-only: set up pending info request for e2e testing ──

if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/calls/:callSid/test-pending-info',
    authenticate,
    (req: Request, res: Response) => {
      const callSid = req.params.callSid as string;
      const { requestedInfo, dataEntryMode, userPhone } = req.body;

      if (!requestedInfo || !userPhone) {
        res.status(400).json({
          success: false,
          error: 'requestedInfo and userPhone required',
        });
        return;
      }

      callStateManager.getCallState(callSid);
      callStateManager.updateCallState(callSid, {
        userPhone,
        transferConfig: {
          transferNumber: process.env.TELNYX_PHONE_NUMBER || '',
          userPhone,
          callPurpose: 'test',
          customInstructions: '',
          aiSettings: {
            model: 'claude-sonnet-4-6',
            maxTokens: 500,
            temperature: 0.3,
          },
        } as any,
      });
      callStateManager.setPendingInfoRequest(
        callSid,
        requestedInfo,
        dataEntryMode
      );

      res.json({ success: true, callSid });
    }
  );
}

// ── Saved Calls CRUD ──

const savedCallBodySchema = z.object({
  name: z.string().min(1).max(200),
  toPhoneNumber: z.string().min(1),
  transferNumber: z.string().min(1),
  callPurpose: z.string().min(1),
  customInstructions: z.string().optional().default(''),
});

router.get(
  '/saved-calls',
  authenticate,
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const calls = await SavedCall.find({ userId: authReq.user!._id }).sort({
      updatedAt: -1,
    });
    res.json({ success: true, savedCalls: calls });
  }
);

router.post(
  '/saved-calls',
  authenticate,
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const parsed = savedCallBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const savedCall = await SavedCall.create({
      ...parsed.data,
      userId: authReq.user!._id,
    });
    res.status(201).json({ success: true, savedCall });
  }
);

router.put(
  '/saved-calls/:id',
  authenticate,
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const parsed = savedCallBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0].message });
      return;
    }
    const savedCall = await SavedCall.findOneAndUpdate(
      { _id: req.params.id, userId: authReq.user!._id },
      parsed.data,
      { new: true }
    );
    if (!savedCall) {
      res.status(404).json({ success: false, error: 'Saved call not found' });
      return;
    }
    res.json({ success: true, savedCall });
  }
);

router.delete(
  '/saved-calls/:id',
  authenticate,
  async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const result = await SavedCall.findOneAndDelete({
      _id: req.params.id,
      userId: authReq.user!._id,
    });
    if (!result) {
      res.status(404).json({ success: false, error: 'Saved call not found' });
      return;
    }
    res.json({ success: true });
  }
);

/**
 * Analyze why a call failed and propose a fix
 */
router.post(
  '/calls/:callSid/analyze-failure',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { callSid } = req.params;
    const { testCaseName, testCaseId } = req.body as {
      testCaseName?: string;
      testCaseId?: string;
    };

    const call = await callHistoryService.getCall(callSid as string);
    if (!call) {
      res.status(404).json({ success: false, error: 'Call not found' });
      return;
    }

    const events = call.events || [];
    const eventsText = events
      .map(e => {
        if (e.eventType === 'conversation')
          return `[${e.type?.toUpperCase()}] ${e.text}`;
        if (e.eventType === 'dtmf')
          return `[DTMF] Press ${e.digit}${e.reason ? ` — ${e.reason}` : ''}`;
        if (e.eventType === 'ivr_menu')
          return `[IVR MENU] ${e.menuOptions?.map(o => `${o.digit}=${o.option}`).join(', ')}`;
        if (e.eventType === 'transfer')
          return `[TRANSFER] ${e.success ? 'SUCCESS' : 'ATTEMPT'} to ${e.transferNumber}`;
        if (e.eventType === 'termination') return `[TERMINATED] ${e.reason}`;
        if (e.eventType === 'hold') return `[HOLD] Hold queue detected`;
        if (e.eventType === 'info_request') return `[INFO REQUEST] ${e.text}`;
        if (e.eventType === 'info_response') return `[INFO RESPONSE] ${e.text}`;
        return `[${e.eventType}]`;
      })
      .join('\n');

    const currentOverride = testCaseId
      ? await TestCaseOverride.findOne({ testCaseId })
      : null;

    const prompt = `You are analyzing a failed automated phone call test. The goal of the call was to navigate the IVR phone system and reach a live human representative.

Test case: ${testCaseName || call.metadata?.callPurpose || 'Unknown'}
Phone: ${call.metadata?.to || 'Unknown'}
Call purpose: ${call.metadata?.callPurpose || 'speak with a representative'}
${currentOverride ? `Current custom instructions: ${currentOverride.customInstructions}` : ''}

Call event timeline:
${eventsText || '(no events recorded)'}

Analyze what went wrong and why the call failed. Then propose specific custom instructions that would help the AI succeed on the next attempt. Custom instructions are extra guidance given to the AI before it starts navigating the IVR.

Respond in this exact JSON format (no markdown, raw JSON only):
{
  "explanation": "2-3 sentence explanation of exactly what went wrong and why",
  "fix": {
    "description": "One sentence summary of the proposed fix",
    "customInstructions": "The exact custom instructions text to add (be specific about digits, menu options, what to say, etc.)"
  }
}`;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw =
      message.content[0].type === 'text' ? message.content[0].text : '';
    let analysis: {
      explanation: string;
      fix: { description: string; customInstructions: string };
    };
    try {
      analysis = JSON.parse(raw);
    } catch {
      res
        .status(500)
        .json({ success: false, error: 'AI returned invalid JSON', raw });
      return;
    }

    res.json({ success: true, analysis });
  }
);

/**
 * Get the current custom instructions override for a test case
 */
router.get(
  '/test-cases/:testCaseId/override',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const override = await TestCaseOverride.findOne({
      testCaseId: req.params.testCaseId,
    });
    res.json({ success: true, override: override ?? null });
  }
);

/**
 * Save a custom instructions override for a test case
 */
router.post(
  '/test-cases/:testCaseId/override',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    const { customInstructions } = req.body as { customInstructions: string };
    if (!customInstructions || typeof customInstructions !== 'string') {
      res
        .status(400)
        .json({ success: false, error: 'customInstructions is required' });
      return;
    }
    await TestCaseOverride.findOneAndUpdate(
      { testCaseId: req.params.testCaseId },
      { customInstructions },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  }
);

/**
 * Delete a custom instructions override for a test case
 */
router.delete(
  '/test-cases/:testCaseId/override',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    await TestCaseOverride.deleteOne({ testCaseId: req.params.testCaseId });
    res.json({ success: true });
  }
);

export default router;
