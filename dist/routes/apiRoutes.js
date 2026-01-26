"use strict";
/**
 * API Routes
 * REST API endpoints for transfer-only calls
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const transfer_config_1 = __importDefault(require("../config/transfer-config"));
const twilioService_1 = __importDefault(require("../services/twilioService"));
const callHistoryService_1 = __importDefault(require("../services/callHistoryService"));
const database_1 = require("../services/database");
const auth_1 = require("../middleware/auth");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const router = express_1.default.Router();
/**
 * Get transfer configuration defaults
 */
router.get('/config', auth_1.authenticate, (_req, res) => {
    res.json({
        success: true,
        config: {
            transferNumber: transfer_config_1.default.defaults.transferNumber,
            userPhone: transfer_config_1.default.defaults.userPhone,
            userEmail: transfer_config_1.default.defaults.userEmail,
            aiSettings: transfer_config_1.default.defaults.aiSettings
        }
    });
});
/**
 * Get the transfer prompt
 */
router.get('/prompt', auth_1.authenticate, (_req, res) => {
    try {
        // Read from source TypeScript file using process.cwd() for reliable path resolution
        const promptPath = path_1.default.join(process.cwd(), 'src/prompts/transfer-prompt.ts');
        const promptContent = fs_1.default.readFileSync(promptPath, 'utf8');
        const promptMatch = promptContent.match(/const systemPrompt = `([\s\S]*?)`;/);
        const prompt = promptMatch ? promptMatch[1] : promptContent;
        res.json({
            success: true,
            prompt: prompt
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to load prompt: ${error.message}. Path attempted: ${path_1.default.join(process.cwd(), 'src/prompts/transfer-prompt.ts')}`
        });
    }
});
/**
 * Get call history
 */
router.get('/calls/history', auth_1.authenticate, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const calls = await callHistoryService_1.default.getRecentCalls(limit);
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
            mongoConnected: (0, database_1.isDbConnected)()
        });
    }
    catch (error) {
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
 */
router.get('/calls/:callSid', auth_1.authenticate, async (req, res) => {
    try {
        const { callSid } = req.params;
        const call = await callHistoryService_1.default.getCall(callSid);
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
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
        return;
    }
});
/**
 * Save settings
 */
router.post('/settings', auth_1.authenticate, (_req, res) => {
    res.json({
        success: true,
        message: 'Settings saved successfully'
    });
});
/**
 * Initiate a transfer-only call
 */
router.post('/calls/initiate', auth_1.authenticate, async (req, res) => {
    try {
        const { to, from, transferNumber, callPurpose, customInstructions } = req.body;
        if (!to) {
            res.status(400).json({
                success: false,
                error: 'Missing required field: to'
            });
            return;
        }
        const config = transfer_config_1.default.createConfig({
            transferNumber: transferNumber || process.env.TRANSFER_PHONE_NUMBER,
            callPurpose: callPurpose || 'speak with a representative',
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
        const call = await twilioService_1.default.initiateCall(to, from || process.env.TWILIO_PHONE_NUMBER || '', twimlUrl);
        await callHistoryService_1.default.startCall(call.sid, {
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
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
        return;
    }
});
exports.default = router;
//# sourceMappingURL=apiRoutes.js.map