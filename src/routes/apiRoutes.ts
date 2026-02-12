/**
 * API Routes
 * REST API endpoints for transfer-only calls
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { validateQuery, ValidatedRequest } from '../middleware/validateQuery';
import transferConfig from '../config/transfer-config';
import twilioService from '../services/twilioService';
import callHistoryService from '../services/callHistoryService';
import evaluationService from '../services/evaluationService';
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
      const limit = parseInt(req.query.limit as string) || 50;
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
          eventCount: call.events ? call.events.length : 0,
        })),
        mongoConnected: isDbConnected(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('Error fetching call history:', error);
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
      console.log('📞 POST /api/calls/initiate');
      console.log('Request body:', JSON.stringify(req.body, null, 2));

      const { to, from, transferNumber, callPurpose, customInstructions } =
        req.body;

      if (!to) {
        console.log('❌ Missing required field: to');
        res.status(400).json({
          success: false,
          error: 'Missing required field: to',
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

      console.log('📋 Call configuration:', {
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose,
        hasCustomInstructions: !!config.customInstructions,
      });

      let baseUrl = process.env.TWIML_URL || process.env.BASE_URL;

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
          console.log('❌ Cannot use localhost URL');
          console.log(
            '💡 Tip: Set TWIML_URL or BASE_URL in .env, or access the app through ngrok'
          );
          res.status(500).json({
            success: false,
            error:
              'Cannot use localhost URL. Please set TWIML_URL or BASE_URL in .env to your ngrok URL (e.g., https://abc123.ngrok-free.app), or access the app through ngrok.',
          });
          return;
        }

        baseUrl = `${detectedProtocol}://${detectedHost}`;
        console.log('🔍 Auto-detected base URL from request:', baseUrl);
        console.log(
          '💡 Tip: Set TWIML_URL or BASE_URL in .env for more reliable URL detection'
        );
      } else {
        console.log('✅ Using configured base URL from environment:', baseUrl);
      }

      if (baseUrl.endsWith('/voice')) {
        baseUrl = baseUrl.replace('/voice', '');
      }

      const params = new URLSearchParams({
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose || 'speak with a representative',
      });
      if (config.customInstructions) {
        params.append('customInstructions', config.customInstructions);
      }
      const twimlUrl = `${baseUrl}/voice?${params.toString()}`;

      console.log('🔗 TwiML URL:', twimlUrl);
      console.log(
        '📞 Initiating call to:',
        to,
        'from:',
        from || process.env.TWILIO_PHONE_NUMBER || 'default'
      );

      // Set up status callback URL to track call status changes
      const statusCallbackUrl = `${baseUrl}/voice/call-status`;

      const call = await twilioService.initiateCall(
        to,
        from || process.env.TWILIO_PHONE_NUMBER || '',
        twimlUrl,
        {
          statusCallback: statusCallbackUrl,
          statusCallbackMethod: 'POST',
        }
      );

      console.log('✅ Call initiated successfully');
      console.log('Call SID:', call.sid);
      console.log('Call status:', call.status);

      await callHistoryService.startCall(call.sid, {
        to: call.to,
        from: call.from,
        transferNumber: config.transferNumber,
        callPurpose: config.callPurpose,
        customInstructions: config.customInstructions,
      });

      console.log('📝 Call history started for:', call.sid);

      res.json({
        success: true,
        call: {
          sid: call.sid,
          status: call.status,
          to: call.to,
          from: call.from,
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
    .transform((val: string | undefined) => (val ? parseInt(val, 10) : undefined))
    .refine((val: number | undefined) => val === undefined || (val > 0 && val <= 365), {
      message: 'Days must be between 1 and 365',
    }),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

router.get(
  '/evaluations',
  authenticate,
  validateQuery(evaluationQuerySchema),
  async (req: Request, res: Response) => {
    const validatedReq = req as ValidatedRequest<z.infer<typeof evaluationQuerySchema>>;
    try {
      if (!isDbConnected()) {
        return res.status(503).json({
          success: false,
          error: 'Database not connected',
        });
      }

      // Now validatedReq.validatedQuery is fully typed! 🎉
      const { days, startDate, endDate } = validatedReq.validatedQuery;

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
  }
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
  validateQuery(breakdownQuerySchema),
  async (req: Request, res: Response) => {
    const validatedReq = req as ValidatedRequest<z.infer<typeof breakdownQuerySchema>>;
  try {
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: 'Database not connected',
      });
    }

    // Now validatedReq.validatedQuery is fully typed! 🎉
    const { startDate: startDateParam, endDate: endDateParam } = validatedReq.validatedQuery;

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
});

export default router;
