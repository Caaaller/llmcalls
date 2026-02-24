/**
 * Call Status Types
 * Defines call status types for Twilio webhooks and internal use
 */

/**
 * Twilio call statuses - all possible statuses from Twilio webhooks
 * Reference: https://www.twilio.com/docs/voice/api/call-resource#call-status-values
 */
export type TwilioCallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

/**
 * Internal call statuses - simplified statuses used in our application
 */
export type CallStatus = 'in-progress' | 'completed' | 'failed' | 'terminated';

/**
 * Map Twilio call status to internal call status
 */
export function mapTwilioStatusToCallStatus(
  twilioStatus: TwilioCallStatus
): CallStatus {
  switch (twilioStatus) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'busy':
    case 'no-answer':
    case 'canceled':
      return 'failed';
    case 'queued':
    case 'ringing':
    case 'in-progress':
      return 'in-progress';
    default:
      return 'failed';
  }
}

/**
 * Check if a Twilio status indicates the call has ended
 */
export function isCallEnded(twilioStatus: TwilioCallStatus): boolean {
  return (
    twilioStatus === 'completed' ||
    twilioStatus === 'failed' ||
    twilioStatus === 'busy' ||
    twilioStatus === 'no-answer' ||
    twilioStatus === 'canceled'
  );
}

/**
 * Check if a Twilio status indicates the call is still active
 */
export function isCallActive(twilioStatus: TwilioCallStatus): boolean {
  return (
    twilioStatus === 'queued' ||
    twilioStatus === 'ringing' ||
    twilioStatus === 'in-progress'
  );
}
