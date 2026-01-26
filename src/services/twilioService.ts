/**
 * Twilio Service
 * Handles Twilio API interactions
 */

import twilio from 'twilio';

export interface CallOptions {
  statusCallback?: string;
  statusCallbackMethod?: 'GET' | 'POST';
  method?: 'GET' | 'POST';
  [key: string]: string | number | boolean | undefined;
}

class TwilioService {
  private client: twilio.Twilio;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    }

    this.client = twilio(accountSid, authToken);
  }

  /**
   * Send DTMF digits
   */
  async sendDTMF(callSid: string, digits: string): Promise<boolean> {
    try {
      // Twilio types don't include sendDigits in CallUpdateOptions, but it's valid
      await this.client.calls(callSid).update({ sendDigits: digits } as twilio.twiml.CallUpdateOptions & { sendDigits: string });
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Error sending DTMF:', err.message);
      return false;
    }
  }

  /**
   * Initiate a call
   */
  async initiateCall(to: string, from: string, url: string, options: CallOptions = {}) {
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
      const err = error as Error;
      throw new Error(`Failed to initiate call: ${err.message}`);
    }
  }

  /**
   * Get call status
   */
  async getCallStatus(callSid: string) {
    try {
      const call = await this.client.calls(callSid).fetch();
      return call;
    } catch (error) {
      const err = error as Error;
      throw new Error(`Failed to get call status: ${err.message}`);
    }
  }

  /**
   * Generate Twilio Access Token for browser client
   */
  generateAccessToken(identity: string, _appName: string): string {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID || accountSid;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      throw new Error('Twilio credentials not configured');
    }

    const token = new AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
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

export default twilioService;

