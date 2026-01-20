/**
 * AI Service
 * Handles OpenAI interactions
 */

const OpenAI = require('openai');
const promptTemplates = require('../prompts/templates');
const transferPrompt = require('../prompts/transfer-prompt');

class AIService {
  constructor() {
    this.client = new OpenAI({
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

    // Check if this is a transfer-only config (has transferNumber property)
    if (scenarioOrConfig.transferNumber || scenarioOrConfig.callPurpose) {
      // Use transfer-only prompt
      const conversationContext = this.buildTransferContext(speechResult, isFirstCall, conversationHistory);
      const promptResult = transferPrompt['transfer-only'](scenarioOrConfig, conversationContext, isFirstCall);
      prompt = promptResult;
      model = scenarioOrConfig.aiSettings?.model || 'gpt-4o';
      maxTokens = scenarioOrConfig.aiSettings?.maxTokens || 150;
      temperature = scenarioOrConfig.aiSettings?.temperature || 0.7;
    } else {
      // Use scenario-based prompt (legacy)
      const scenario = scenarioOrConfig;
      const template = promptTemplates[scenario.promptTemplate];
      if (!template) {
        throw new Error(`Prompt template "${scenario.promptTemplate}" not found`);
      }

      const conversationContext = promptTemplates.buildConversationContext(
        scenario,
        speechResult,
        isFirstCall,
        conversationHistory
      );

      const promptResult = template(scenario.userData, conversationContext, isFirstCall);
      prompt = promptResult;
      model = scenario.aiSettings.model || 'gpt-4-turbo-preview';
      maxTokens = scenario.aiSettings.maxTokens || 100;
      temperature = scenario.aiSettings.temperature || 0.7;
    }

    // Generate response
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
    } else {
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

module.exports = aiService;

