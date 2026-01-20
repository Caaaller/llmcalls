/**
 * Twilio Service
 * Handles Twilio API interactions
 */

const twilio = require('twilio');

class TwilioService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  /**
   * Send DTMF digits
   */
  async sendDTMF(callSid, digits) {
    try {
      await this.client.calls(callSid).update({ sendDigits: digits });
      return true;
    } catch (error) {
      console.error('Error sending DTMF:', error.message);
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
    } catch (error) {
      throw new Error(`Failed to initiate call: ${error.message}`);
    }
  }

  /**
   * Get call status
   */
  async getCallStatus(callSid) {
    try {
      const call = await this.client.calls(callSid).fetch();
      return call;
    } catch (error) {
      throw new Error(`Failed to get call status: ${error.message}`);
    }
  }

  /**
   * Generate Twilio Access Token for browser client
   */
  generateAccessToken(identity, appName) {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN,
      { identity }
    );

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

module.exports = twilioService;


