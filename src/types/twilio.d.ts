/**
 * Type definitions for Twilio TwiML properties
 * Extends Twilio types to include properties not fully covered by @types/twilio
 */

declare module 'twilio' {
  namespace twiml {
    interface VoiceResponse {
      gather(attributes?: GatherAttributes): Gather;
      say(attributes: SayAttributes, text: string): Say;
      dial(attributes?: DialAttributes, number?: string): Dial;
      hangup(): Hangup;
    }

    interface GatherAttributes {
      input?: string[] | string;
      language?: string;
      speechTimeout?: string | number;
      action?: string;
      method?: string;
      enhanced?: boolean;
      timeout?: number;
      numDigits?: number;
      finishOnKey?: string;
    }

    interface SayAttributes {
      voice?: string;
      language?: string;
      loop?: number;
    }

    interface DialAttributes {
      answerOnMedia?: boolean;
      [key: string]: string | number | boolean | undefined;
    }

    interface Gather {
      say(attributes: SayAttributes, text: string): Say;
    }

    interface Say {
      // Say methods
    }

    interface Dial {
      number(phoneNumber: string, attributes?: Record<string, string | number | boolean | undefined>): void;
    }

    interface Hangup {
      // Hangup methods
    }
  }
}

export {};

