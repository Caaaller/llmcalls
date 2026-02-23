/**
 * TwiML Helper Functions
 * Shared utilities for building Twilio TwiML responses
 */

import twilio from 'twilio';
import { TwilioGatherInput, TwilioSayAttributes } from '../types/twilio-twiml';
import { TransferConfig as TransferConfigType } from '../config/transfer-config';

const DEFAULT_SPEECH_TIMEOUT = 15;

export interface TwiMLDialAttributes {
  answerOnMedia?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface BuildProcessSpeechUrlParams {
  baseUrl: string;
  config: TransferConfigType;
  additionalParams?: Record<string, string>;
}

export function buildProcessSpeechUrl({
  baseUrl,
  config,
  additionalParams = {},
}: BuildProcessSpeechUrlParams): string {
  const params = new URLSearchParams();
  params.append('transferNumber', config.transferNumber);
  if (config.callPurpose) {
    params.append('callPurpose', config.callPurpose);
  }
  if (config.customInstructions) {
    params.append('customInstructions', config.customInstructions);
  }
  Object.entries(additionalParams).forEach(([key, value]) => {
    params.append(key, value);
  });
  return `${baseUrl}/voice/process-speech?${params.toString()}`;
}

export function createGatherAttributes(
  config: TransferConfigType,
  overrides: Partial<TwilioGatherInput> = {}
): TwilioGatherInput {
  return {
    input: ['speech'],
    language: config.aiSettings.language || 'en-US',
    speechTimeout: 'auto',
    timeout: DEFAULT_SPEECH_TIMEOUT,
    ...overrides,
  };
}

export function createSayAttributes(
  config: TransferConfigType,
  overrides: Partial<TwilioSayAttributes> = {}
): TwilioSayAttributes {
  return {
    voice: config.aiSettings.voice || 'Polly.Matthew',
    language: config.aiSettings.language || 'en-US',
    ...overrides,
  };
}

export function dialNumber(
  dial: ReturnType<twilio.twiml.VoiceResponse['dial']>,
  phoneNumber: string
): void {
  dial.number(phoneNumber);
}

export function getBaseUrl(req: { protocol?: string; get?: (header: string) => string | undefined; hostname?: string }): string {
  const protocol = req.protocol || 'https';
  const host = req.get?.('host') || req.hostname;
  if (!host) {
    throw new Error('getBaseUrl: host is missing (req.get("host") and req.hostname are undefined)');
  }
  return `${protocol}://${host}`;
}

