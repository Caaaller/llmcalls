/**
 * Transfer-Only Configuration
 * Simplified configuration for transfer-only phone navigation
 */

export interface AISettings {
  model: string;
  maxTokens: number;
  temperature: number;
  voice?: string;
  language?: string;
}

export interface TransferConfig {
  transferNumber: string;
  userPhone: string;
  userEmail: string;
  customInstructions?: string;
  callPurpose?: string;
  aiSettings: AISettings;
}

export interface UserInput {
  transferNumber?: string;
  userPhone?: string;
  userEmail?: string;
  customInstructions?: string;
  callPurpose?: string;
  aiSettings?: Partial<AISettings>;
}

const transferConfig = {
  /**
   * Default transfer configuration
   */
  defaults: {
    transferNumber: process.env.TRANSFER_PHONE_NUMBER || '720-584-6358',
    userPhone: process.env.USER_PHONE_NUMBER || '720-584-6358',
    userEmail: process.env.USER_EMAIL || 'oliverullman@gmail.com',
    aiSettings: {
      model: 'gpt-4o',
      maxTokens: 150,
      temperature: 0.7,
      voice: 'Polly.Matthew',
      language: 'en-US'
    } as AISettings
  },

  /**
   * Create transfer configuration from user input
   */
  createConfig(userInput: UserInput = {}): TransferConfig {
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

export default transferConfig;

