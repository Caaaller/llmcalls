"use strict";
/**
 * AI Service
 * Handles OpenAI interactions
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = __importDefault(require("openai"));
const transfer_prompt_1 = require("../prompts/transfer-prompt");
class AIService {
    constructor() {
        this.client = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    /**
     * Generate AI response based on scenario or transfer config
     */
    async generateResponse(scenarioOrConfig, speechResult, isFirstCall, conversationHistory = []) {
        if (!this.client) {
            throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
        }
        let prompt;
        let model;
        let maxTokens;
        let temperature;
        // Check if this is a transfer-only config
        const config = scenarioOrConfig;
        if (config.transferNumber || config.callPurpose) {
            const conversationContext = this.buildTransferContext(speechResult, isFirstCall, conversationHistory);
            const promptResult = transfer_prompt_1.transferPrompt['transfer-only'](config, conversationContext, isFirstCall);
            prompt = promptResult;
            model = config.aiSettings?.model || 'gpt-4o';
            maxTokens = config.aiSettings?.maxTokens || 150;
            temperature = config.aiSettings?.temperature || 0.7;
        }
        else {
            throw new Error('Legacy scenario-based prompts are no longer supported. Use transfer config.');
        }
        const completion = await this.client.chat.completions.create({
            model: model,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user || speechResult }
            ],
            max_tokens: maxTokens,
            temperature: temperature,
        });
        const aiResponse = completion.choices[0].message.content;
        if (!aiResponse) {
            throw new Error('No response from OpenAI');
        }
        return aiResponse;
    }
    /**
     * Build conversation context for transfer-only calls
     */
    buildTransferContext(speechResult, isFirstCall, conversationHistory = []) {
        if (isFirstCall) {
            return `The automated system said: "${speechResult}". 
      You are navigating their IVR system to reach a live representative.
      IMPORTANT: Only respond when necessary for navigation. Remain silent during menu prompts.`;
        }
        else {
            const history = conversationHistory.length > 0
                ? `\nPrevious conversation:\n${conversationHistory.map((h, i) => `${i + 1}. ${h.text || h}`).join('\n')}\n`
                : '';
            return `Continuing navigation. The automated system said: "${speechResult}".${history}
      Focus on navigation and reaching a live representative.`;
        }
    }
}
// Singleton instance
const aiService = new AIService();
exports.default = aiService;
//# sourceMappingURL=aiService.js.map