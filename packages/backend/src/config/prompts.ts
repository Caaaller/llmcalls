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

Does this contain a DIRECT QUESTION to you (yes/no question, request for info, "what are you calling about?", etc.)?
- If YES → you MUST answer it. Do NOT stay silent on questions.
- If NO (greeting, intro, disclaimer, promo) → output ONLY "silent".

You are the CALLER, not the company.`;
  },

  /**
   * Continuing call context message
   */
  continuingCallContext: (
    speechResult: string,
    conversationHistory: string
  ): string => {
    return `Continuing navigation. The automated system said: "${speechResult}".${conversationHistory}

Does this contain a DIRECT QUESTION or request for information from you?
- "Is that right/correct?" → say "Yes" or "No"
- "Say yes or no" → say "Yes" or "No"
- Asking for phone/ZIP/account → provide it
- Any question to you → ANSWER it. Do NOT stay silent on questions.
- Not a question (hold msg, promo, processing, disclaimer) → output ONLY "silent".

You are the CALLER, not the company.`;
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
