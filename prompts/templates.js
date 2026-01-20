/**
 * Prompt Templates
 * Legacy file - kept for backward compatibility
 * All prompts now use transfer-prompt.js
 */

module.exports = {
  /**
   * Build conversation context (legacy helper)
   * This is now handled in aiService.js for transfer-only calls
   */
  buildConversationContext(scenario, speechResult, isFirstCall, conversationHistory = []) {
    // This function is deprecated - transfer-only calls use aiService.buildTransferContext
    return `The automated system said: "${speechResult}".`;
  }
};
