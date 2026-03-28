/**
 * URL Helper Functions
 * Shared utilities for building webhook URLs
 */

import { TransferConfig as TransferConfigType } from '../config/transfer-config';

export const DEFAULT_SPEECH_TIMEOUT = 15;

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

export function getBaseUrl(req: {
  protocol?: string;
  get?: (header: string) => string | undefined;
  hostname?: string;
}): string {
  const protocol = req.protocol || 'https';
  const host = req.get?.('host') || req.hostname;
  if (!host) {
    throw new Error(
      'getBaseUrl: host is missing (req.get("host") and req.hostname are undefined)'
    );
  }
  return `${protocol}://${host}`;
}
