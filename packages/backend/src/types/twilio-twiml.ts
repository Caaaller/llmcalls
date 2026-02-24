/**
 * Type definitions for Twilio TwiML attributes
 * These types extend Twilio's types to cover properties not fully typed
 */

export interface TwilioGatherInput {
  input?: string[];
  language?: string;
  speechTimeout?: string | number;
  action?: string;
  method?: string;
  enhanced?: boolean;
  timeout?: number;
  numDigits?: number;
  finishOnKey?: string;
}

export interface TwilioSayAttributes {
  voice?: string;
  language?: string;
  loop?: number;
}

export interface TwilioDialAttributes {
  answerOnMedia?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface TwilioCallUpdateOptions {
  sendDigits?: string;
  [key: string]: string | number | boolean | undefined;
}
