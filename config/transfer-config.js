/**
 * Transfer-Only Configuration
 * Simplified configuration for transfer-only phone navigation
 */

module.exports = {
  /**
   * Default transfer configuration
   */
  defaults: {
    transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
    userPhone: process.env.USER_PHONE_NUMBER || '720-584-6358',
    userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
    aiSettings: {
      model: 'gpt-4o', // Latest GPT-4 model - faster, cheaper, and better than gpt-4-turbo-preview
      maxTokens: 150,
      temperature: 0.7,
      voice: 'Polly.Matthew', // Professional male voice
      language: 'en-US'
    }
  },

  /**
   * Create transfer configuration from user input
   */
  createConfig(userInput = {}) {
    return {
      transferNumber: userInput.transferNumber || this.defaults.transferNumber,
      userPhone: userInput.userPhone || this.defaults.userPhone,
      userEmail: userInput.userEmail || this.defaults.userEmail,
      customInstructions: userInput.customInstructions || '',
      callPurpose: userInput.callPurpose || 'speak with a representative',
      aiSettings: {
        ...this.defaults.aiSettings,
        ...(userInput.aiSettings || {})
      }
    };
  }
};

