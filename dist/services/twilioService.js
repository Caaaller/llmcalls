"use strict";
/**
 * Twilio Service
 * Handles Twilio API interactions
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const twilio_1 = __importDefault(require("twilio"));
class TwilioService {
    constructor() {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) {
            throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
        }
        this.client = (0, twilio_1.default)(accountSid, authToken);
    }
    /**
     * Send DTMF digits
     */
    async sendDTMF(callSid, digits) {
        try {
            await this.client.calls(callSid).update({ sendDigits: digits });
            return true;
        }
        catch (error) {
            const err = error;
            console.error('Error sending DTMF:', err.message);
            return false;
        }
    }
    /**
     * Initiate a call
     */
    async initiateCall(to, from, url, options = {}) {
        try {
            const call = await this.client.calls.create({
                to,
                from,
                url,
                method: 'POST',
                statusCallback: options.statusCallback,
                statusCallbackMethod: 'POST',
                ...options
            });
            return call;
        }
        catch (error) {
            const err = error;
            throw new Error(`Failed to initiate call: ${err.message}`);
        }
    }
    /**
     * Get call status
     */
    async getCallStatus(callSid) {
        try {
            const call = await this.client.calls(callSid).fetch();
            return call;
        }
        catch (error) {
            const err = error;
            throw new Error(`Failed to get call status: ${err.message}`);
        }
    }
    /**
     * Generate Twilio Access Token for browser client
     */
    generateAccessToken(identity, _appName) {
        const AccessToken = twilio_1.default.jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const apiKeySid = process.env.TWILIO_API_KEY_SID || accountSid;
        const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !apiKeySid || !apiKeySecret) {
            throw new Error('Twilio credentials not configured');
        }
        const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity });
        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: process.env.TWILIO_APP_SID,
            incomingAllow: true,
        });
        token.addGrant(voiceGrant);
        return token.toJwt();
    }
}
// Singleton instance
const twilioService = new TwilioService();
exports.default = twilioService;
//# sourceMappingURL=twilioService.js.map