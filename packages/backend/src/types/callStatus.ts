/**
 * Call Status Types
 * Internal call statuses and Telnyx status mapping
 */

export type TelnyxCallStatus =
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'hangup'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'canceled';

/**
 * Internal call statuses - simplified statuses used in our application
 */
export type CallStatus = 'in-progress' | 'completed' | 'failed' | 'terminated';

/**
 * Map Telnyx call status to internal call status
 */
export function mapTelnyxStatusToCallStatus(
  telnyxStatus: TelnyxCallStatus
): CallStatus {
  switch (telnyxStatus) {
    case 'answered':
      return 'in-progress';
    case 'hangup':
      return 'completed';
    case 'failed':
    case 'busy':
    case 'no-answer':
    case 'canceled':
      return 'failed';
    case 'initiated':
    case 'ringing':
      return 'in-progress';
    default:
      return 'failed';
  }
}

/**
 * Check if a Telnyx event type indicates the call has ended
 */
export function isCallEnded(eventType: string): boolean {
  return (
    eventType === 'call.hangup' ||
    eventType === 'hangup' ||
    eventType === 'failed' ||
    eventType === 'busy' ||
    eventType === 'no-answer' ||
    eventType === 'canceled'
  );
}

/**
 * Check if a Telnyx status indicates the call is still active
 */
export function isCallActive(status: TelnyxCallStatus): boolean {
  return (
    status === 'initiated' || status === 'ringing' || status === 'answered'
  );
}
