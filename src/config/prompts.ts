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
You are navigating their IVR system to reach a live representative.
IMPORTANT: Only respond when necessary for navigation. Remain silent during menu prompts.`;
  },

  /**
   * Continuing call context message
   */
  continuingCallContext: (speechResult: string, conversationHistory: string): string => {
    return `Continuing navigation. The automated system said: "${speechResult}".${conversationHistory}
Focus on navigation and reaching a live representative.`;
  },

  /**
   * Format conversation history for context
   */
  formatConversationHistory: (conversationHistory: Array<{ text?: string }>): string => {
    return conversationHistory.length > 0 
      ? `\nPrevious conversation:\n${conversationHistory.map((h, i) => `${i + 1}. ${h.text || h}`).join('\n')}\n`
      : '';
  },
};

export default promptConfig;


