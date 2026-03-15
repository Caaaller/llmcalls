/**
 * Shared types for voice processing
 * Extracted from deleted services for backward compatibility
 */

import { MenuOption } from './menu';

export interface DTMFDecision {
  callPurpose: string;
  shouldPress: boolean;
  digit: string | null;
  matchedOption: string;
  matchType: 'exact' | 'semantic' | 'fallback';
  reason: string;
}

export interface VoiceProcessingResult {
  isIVRMenu: boolean;
  menuOptions: MenuOption[];
  isMenuComplete: boolean;
  loopDetected: boolean;
  loopConfidence?: number;
  loopReason?: string;
  shouldTerminate: boolean;
  terminationReason?: string;
  transferRequested: boolean;
  transferConfidence?: number;
  transferReason?: string;
  dtmfDecision: DTMFDecision;
  shouldPreventDTMF: boolean;
}

export interface TransferConfig {
  transferNumber: string;
  callPurpose?: string;
  customInstructions?: string;
  userPhone?: string;
  userEmail?: string;
  aiSettings?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
}
