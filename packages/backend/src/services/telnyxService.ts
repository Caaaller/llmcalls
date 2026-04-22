/**
 * Telnyx Service
 * Handles Telnyx Call Control API interactions
 */

import Telnyx from 'telnyx';
import { toError } from '../utils/errorUtils';
import callStateManager from './callStateManager';

function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+') && digits.length >= 7) return `+${digits}`;
  return null;
}

const DTMF_DEDUP_WINDOW_MS = 3000;

interface LastDtmf {
  digits: string;
  at: number;
}

class TelnyxService {
  private client: Telnyx;
  private lastDtmfByCall = new Map<string, LastDtmf>();

  constructor() {
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new Error('TELNYX_API_KEY must be set');
    }
    this.client = new Telnyx({ apiKey });
  }

  /**
   * Single source of truth for "don't fire outbound Telnyx actions at a
   * call we already hung up on." Wraps per-call actions so in-flight LLM
   * reasoning can't ghost-act on a dead leg (e.g. transfer firing 14s
   * after the caller hung up). Does NOT apply to terminateCall (idempotent),
   * read-only status calls, SMS, or outbound createCall.
   */
  private async guardedAction<T>(
    callSid: string,
    name: string,
    fn: () => Promise<T>
  ): Promise<T | undefined> {
    if (callStateManager.isCallEnded(callSid)) {
      console.log(`🔇 Skipping ${name} — call already ended`);
      return undefined;
    }
    return fn();
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
    await this.guardedAction(callControlId, 'speakText', async () => {
      const resolvedVoice = voice || 'Telnyx.KokoroTTS.am_michael';
      const voiceSettings = resolvedVoice.startsWith('Telnyx.KokoroTTS.')
        ? { type: 'telnyx' as const, voice_speed: 1.0 }
        : undefined;
      try {
        await this.client.calls.actions.speak(callControlId, {
          payload: text,
          voice: resolvedVoice,
          ...(voiceSettings && { voice_settings: voiceSettings }),
        });
      } catch (error) {
        console.error('Error speaking text:', toError(error).message);
        throw error;
      }
    });
  }

  /**
   * Stop in-flight TTS playback on the call. Used by barge-in cancellation
   * when we detect the user/live agent speaking while we're speaking.
   * Telnyx's speak queues onto the playback pipeline, so stopPlayback
   * cancels it and emits `call.speak.ended`.
   */
  async stopSpeak(callControlId: string): Promise<void> {
    await this.guardedAction(callControlId, 'stopSpeak', async () => {
      try {
        await this.client.calls.actions.stopPlayback(callControlId, {
          stop: 'current',
        });
      } catch (error) {
        const err = toError(error);
        // 90018 / "already ended" are fine — call ended underneath us.
        // Also tolerate "no audio playing" since TTS may have finished
        // between our decision to cancel and the API call.
        if (
          !err.message.includes('90018') &&
          !err.message.includes('already ended') &&
          !err.message.includes('no audio')
        ) {
          console.error('stopSpeak error:', err.message);
        }
      }
    });
  }

  async sendDTMF(callControlId: string, digits: string): Promise<boolean> {
    const result = await this.guardedAction(
      callControlId,
      'sendDTMF',
      async () => {
        const now = Date.now();
        const last = this.lastDtmfByCall.get(callControlId);
        if (
          last &&
          last.digits === digits &&
          now - last.at < DTMF_DEDUP_WINDOW_MS
        ) {
          console.log(
            `[DTMF] Duplicate press suppressed: ${digits} (${now - last.at}ms since last)`
          );
          return false;
        }
        try {
          await this.client.calls.actions.sendDtmf(callControlId, {
            digits,
            duration_millis: 500,
          });
          this.lastDtmfByCall.set(callControlId, { digits, at: now });
          return true;
        } catch (error) {
          console.error('Error sending DTMF:', toError(error).message);
          return false;
        }
      }
    );
    return result ?? false;
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
    await this.guardedAction(callControlId, 'transfer', async () => {
      const e164 = toE164(to);
      const from = process.env.TELNYX_PHONE_NUMBER;
      console.log(
        `🔄 Transferring ${callControlId.slice(-20)} to ${e164 ?? to} from ${from}`
      );
      await this.client.calls.actions.transfer(callControlId, {
        to: e164 ?? to,
        from: from || undefined,
      });
    });
  }

  async getCallStatus(callControlId: string) {
    return this.client.calls.retrieveStatus(callControlId);
  }

  async startStreaming(
    callControlId: string,
    streamUrl: string
  ): Promise<void> {
    await this.guardedAction(callControlId, 'startStreaming', async () => {
      await this.client.calls.actions.startStreaming(callControlId, {
        stream_url: streamUrl,
        stream_track: 'inbound_track',
        stream_codec: 'PCMU',
      });
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
