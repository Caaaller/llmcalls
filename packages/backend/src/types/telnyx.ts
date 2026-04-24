/**
 * Telnyx webhook event and Call Control type definitions
 */

export type TelnyxEventType =
  | 'call.answered'
  | 'call.hangup'
  | 'call.speak.ended'
  | 'call.speak.started'
  | 'call.transcription'
  | 'call.recording.saved'
  | 'call.initiated'
  | 'call.bridged'
  | 'call.dtmf.received';

export type TelnyxCallStatus =
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'hangup'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'canceled';

export interface TelnyxWebhookPayload {
  call_control_id?: string;
  call_leg_id?: string;
  call_session_id?: string;
  client_state?: string;
  connection_id?: string;
  from?: string;
  to?: string;
  direction?: 'incoming' | 'outgoing' | string;
  state?: TelnyxCallStatus;
  hangup_cause?: string;
  hangup_source?: 'caller' | 'callee' | 'unknown' | string;
  recording_url?: string;
  recording_id?: string;
  duration_secs?: number;
  transcription_data?: {
    transcript?: string;
    is_final?: boolean;
    confidence?: number;
    transcription_track?: 'inbound' | 'outbound';
  };
}

export interface TelnyxWebhookEvent {
  event_type?: TelnyxEventType;
  id?: string;
  occurred_at?: string;
  record_type?: 'event';
  payload?: TelnyxWebhookPayload;
}

export interface TelnyxWebhookBody {
  data?: TelnyxWebhookEvent;
  meta?: Record<string, unknown>;
}

/** Config encoded into client_state for each Telnyx call */
export interface TelnyxCallConfig {
  transferNumber: string;
  callPurpose?: string;
  customInstructions?: string;
  userPhone?: string;
  userEmail?: string;
  skipInfoRequests?: boolean;
  /**
   * Set TRUE for test cases where reaching a live agent is the only valid outcome
   * (e.g. USPS "failed package pickup"). When true, the AI refuses callback
   * offers that would bypass the live-agent queue. Normal calls leave this
   * false/undefined so callbacks are accepted (they're faster for the user).
   */
  requireLiveAgent?: boolean;
}

export function encodeClientState(config: TelnyxCallConfig): string {
  return Buffer.from(JSON.stringify(config)).toString('base64');
}

export function decodeClientState(
  clientState: string | undefined
): TelnyxCallConfig | null {
  if (!clientState) return null;
  try {
    return JSON.parse(Buffer.from(clientState, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Client-state payload written by `telnyxService.dialForBridge` on the
 * user-facing leg of a blind transfer. When the webhook sees `call.answered`
 * on a leg carrying this payload, it bridges that leg to the original source
 * call so audio flows A↔C directly and the AI drops out of the media path.
 */
export interface BridgeClientState {
  bridgeSourceCallControlId: string;
}

export function encodeBridgeClientState(state: BridgeClientState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function decodeBridgeSourceFromClientState(
  clientState: string | undefined
): string | null {
  if (!clientState) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(clientState, 'base64').toString('utf8')
    );
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.bridgeSourceCallControlId === 'string' &&
      parsed.bridgeSourceCallControlId.length > 0
    ) {
      return parsed.bridgeSourceCallControlId;
    }
    return null;
  } catch {
    return null;
  }
}
