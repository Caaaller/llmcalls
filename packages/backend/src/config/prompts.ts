/**
 * Prompt Configuration
 * Centralized location for all prompt templates and messages
 */

export const promptConfig = {
  /**
   * First call context message
   */
  firstCallContext: (speechResult: string): string => {
    return `The automated system said: "${speechResult}".
You are the CALLER navigating their phone system to reach a live representative.
IMPORTANT: If this is just a greeting or introduction, remain SILENT and wait for the system to ask a question or present options. If the system asks what you need, state the call purpose naturally.`;
  },

  /**
   * Continuing call context message
   */
  continuingCallContext: (
    speechResult: string,
    conversationHistory: string
  ): string => {
    return `Continuing navigation. The automated system said: "${speechResult}".${conversationHistory}
You are the CALLER. Focus on navigation and reaching a live representative. If the system asks what you need, state the call purpose. If it's still talking, remain silent.`;
  },

  /**
   * Format conversation history for context
   */
  formatConversationHistory: (
    conversationHistory: Array<{ text?: string }>
  ): string => {
    return conversationHistory.length > 0
      ? `\nPrevious conversation:\n${conversationHistory.map((h, i) => `${i + 1}. ${h.text || h}`).join('\n')}\n`
      : '';
  },
};

export default promptConfig;
