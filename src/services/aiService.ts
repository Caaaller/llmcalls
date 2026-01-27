/**
 * AI Service
 * Handles OpenAI interactions
 */

import OpenAI from 'openai';
import { transferPrompt } from '../prompts/transfer-prompt';
import promptConfig from '../config/prompts';

export interface ConversationEntry {
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp?: Date;
}

export interface TransferConfig {
  transferNumber: string;
  callPurpose?: string;
  customInstructions?: string;
  aiSettings?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export interface UserData {
  [key: string]: string | number | boolean | null | undefined;
}

export interface Scenario {
  promptTemplate?: string;
  userData?: UserData;
  aiSettings: {
    model: string;
    maxTokens: number;
    temperature: number;
  };
}

export interface PromptResult {
  system: string;
  user?: string;
}

class AIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate AI response based on scenario or transfer config
   */
  async generateResponse(
    scenarioOrConfig: TransferConfig | Scenario,
    speechResult: string,
    isFirstCall: boolean,
    conversationHistory: ConversationEntry[] = []
  ): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
    }

    let prompt: PromptResult;
    let model: string;
    let maxTokens: number;
    let temperature: number;

    // Check if this is a transfer-only config
    const config = scenarioOrConfig as TransferConfig;
    if (config.transferNumber || config.callPurpose) {
      const conversationContext = this.buildTransferContext(speechResult, isFirstCall, conversationHistory);
      const promptResult = transferPrompt['transfer-only'](config, conversationContext, isFirstCall);
      prompt = promptResult;
      model = config.aiSettings?.model || 'gpt-4o';
      maxTokens = config.aiSettings?.maxTokens || 150;
      temperature = config.aiSettings?.temperature || 0.7;
    } else {
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
  buildTransferContext(speechResult: string, isFirstCall: boolean, conversationHistory: ConversationEntry[] = []): string {
    if (isFirstCall) {
      return promptConfig.firstCallContext(speechResult);
    } else {
      const history = promptConfig.formatConversationHistory(conversationHistory);
      return promptConfig.continuingCallContext(speechResult, history);
    }
  }
}

// Singleton instance
const aiService = new AIService();

export default aiService;


