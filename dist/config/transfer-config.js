"use strict";
/**
 * Transfer-Only Configuration
 * Simplified configuration for transfer-only phone navigation
 */
Object.defineProperty(exports, "__esModule", { value: true });
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
exports.default = transferConfig;
//# sourceMappingURL=transfer-config.js.map