/**
 * Detection Patterns Constants
 * Centralized text patterns used by various detection utilities
 */

/**
 * Patterns indicating the business is closed
 */
export const CLOSED_PATTERNS = [
  'we are currently closed',
  'our office is currently closed',
  'outside of our normal business hours',
  'our hours are',
  'business hours are',
  'please call back during business hours',
] as const;

/**
 * Patterns indicating voicemail recording has started
 */
export const VOICEMAIL_PATTERNS = [
  'please leave a message after the beep',
  'please leave your message after the tone',
  'record your message',
  'at the tone',
  'voicemail',
  'leave a message',
] as const;

/**
 * Patterns indicating a transfer request
 */
export const TRANSFER_PATTERNS = [
  'transfer me',
  'transfer the call',
  'transfer this call',
  'speak to a representative',
  'speak with a representative',
  'customer service',
  'human representative',
  'real person',
  'agent',
  'operator',
  'representative please',
  'talk to someone',
  'talk to a person',
  "i'm transferring you",
  'i am transferring you',
  'i will transfer you',
  'you will be transferred',
  "you'll be transferred",
  'connect you',
  'connect you with',
  'connect you to',
  'let me connect',
  'connecting you',
  'please hold',
  'hold please',
  'one moment',
  'transferring you now',
  'transferring your call',
] as const;
