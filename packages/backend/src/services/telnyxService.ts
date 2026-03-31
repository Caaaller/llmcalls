/**
 * Telnyx Service
 * Handles Telnyx Call Control API interactions
 */

import Telnyx from 'telnyx';
import { toError } from '../utils/errorUtils';

function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+') && digits.length >= 7) return `+${digits}`;
  return null;
}

class TelnyxService {
  private client: Telnyx;

  constructor() {
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new Error('TELNYX_API_KEY must be set');
    }
    this.client = new Telnyx({ apiKey });
  }

  async initiateCall(
    to: string,
    from: string,
    clientState?: string,
    webhookUrl?: string
  ) {
    const connectionId = process.env.TELNYX_CONNECTION_ID;
    if (!connectionId) {
      throw new Error('TELNYX_CONNECTION_ID must be set');
    }

    const response = await this.client.calls.dial({
      connection_id: connectionId,
      to,
      from,
      record: 'record-from-answer',
      record_channels: 'dual',
      record_format: 'mp3',
      ...(clientState && { client_state: clientState }),
      ...(webhookUrl && { webhook_url: webhookUrl }),
    });

    const data = response.data as { call_control_id?: string; state?: string };
    console.log(
      `Call created: ${data.call_control_id} (${data.state}) to=${to}`
    );
    return {
      sid: data.call_control_id ?? '',
      status: data.state ?? 'initiated',
    };
  }

  async speakText(
    callControlId: string,
    text: string,
    voice?: string
  ): Promise<void> {
    try {
      await this.client.calls.actions.speak(callControlId, {
        payload: text,
        voice: voice || 'AWS.Polly.Matthew-Neural',
      });
    } catch (error) {
      console.error('Error speaking text:', toError(error).message);
      throw error;
    }
  }

  async sendDTMF(callControlId: string, digits: string): Promise<boolean> {
    try {
      await this.client.calls.actions.sendDtmf(callControlId, { digits });
      return true;
    } catch (error) {
      console.error('Error sending DTMF:', toError(error).message);
      return false;
    }
  }

  async terminateCall(callControlId: string): Promise<void> {
    try {
      await this.client.calls.actions.hangup(callControlId, {});
    } catch (error) {
      const err = toError(error);
      // 90018 = call already ended — not an error we need to propagate
      if (
        !err.message.includes('90018') &&
        !err.message.includes('already ended')
      ) {
        throw error;
      }
    }
  }

  async transfer(callControlId: string, to: string): Promise<void> {
    const e164 = toE164(to);
    await this.client.calls.actions.transfer(callControlId, {
      to: e164 ?? to,
    });
  }

  async getCallStatus(callControlId: string) {
    return this.client.calls.retrieveStatus(callControlId);
  }

  async startStreaming(
    callControlId: string,
    streamUrl: string
  ): Promise<void> {
    await this.client.calls.actions.startStreaming(callControlId, {
      stream_url: streamUrl,
      stream_track: 'inbound_track',
      stream_codec: 'PCMU',
    });
  }

  async sendSMS(to: string, body: string): Promise<void> {
    const from = process.env.TELNYX_PHONE_NUMBER;
    if (!from) {
      throw new Error('TELNYX_PHONE_NUMBER must be set to send SMS');
    }
    await this.client.messages.send({ to, from, text: body });
  }
}

const telnyxService = new TelnyxService();
export default telnyxService;
