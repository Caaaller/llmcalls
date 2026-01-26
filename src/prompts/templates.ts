/**
 * Prompt Templates
 * Legacy file - kept for backward compatibility
 * All prompts now use transfer-prompt.ts
 */

import { ConversationEntry } from '../services/aiService';
import { TransferConfig } from '../config/transfer-config';

export const buildConversationContext = (
  _scenario: TransferConfig,
  speechResult: string,
  _isFirstCall: boolean,
  _conversationHistory: ConversationEntry[] = []
): string => {
  // This function is deprecated - transfer-only calls use aiService.buildTransferContext
  return `The automated system said: "${speechResult}".`;
};

export default {
  buildConversationContext
};

