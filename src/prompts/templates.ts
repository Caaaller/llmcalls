/**
 * Prompt Templates
 * Legacy file - kept for backward compatibility
 * All prompts now use transfer-prompt.ts
 */

export const buildConversationContext = (
  _scenario: any,
  speechResult: string,
  _isFirstCall: boolean,
  _conversationHistory: any[] = []
): string => {
  // This function is deprecated - transfer-only calls use aiService.buildTransferContext
  return `The automated system said: "${speechResult}".`;
};

export default {
  buildConversationContext
};

