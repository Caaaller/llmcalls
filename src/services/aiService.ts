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
  userPhone?: string;
  userEmail?: string;
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
      const conversationContext = this.buildTransferContext(
        speechResult,
        isFirstCall,
        conversationHistory
      );
      const promptResult = transferPrompt['transfer-only'](
        config,
        conversationContext,
        isFirstCall
      );

      prompt = promptResult;
      model = config.aiSettings?.model || 'gpt-4o';
      maxTokens = config.aiSettings?.maxTokens || 150;
      temperature = config.aiSettings?.temperature || 0.7;
    } else {
      throw new Error(
        'Legacy scenario-based prompts are no longer supported. Use transfer config.'
      );
    }

    const completion = await this.client.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user || speechResult },
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
  buildTransferContext(
    speechResult: string,
    isFirstCall: boolean,
    conversationHistory: ConversationEntry[] = []
  ): string {
    if (isFirstCall) {
      return promptConfig.firstCallContext(speechResult);
    } else {
      const history =
        promptConfig.formatConversationHistory(conversationHistory);
      return promptConfig.continuingCallContext(speechResult, history);
    }
  }

  /**
   * Validate if we are speaking with a real human (not an automated system)
   * Returns true if AI confirms this is a real human, false otherwise
   */
  async confirmTransferRequest(
    config: TransferConfig,
    speechResult: string,
    conversationHistory: ConversationEntry[] = []
  ): Promise<boolean> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
    }

    const history = promptConfig.formatConversationHistory(conversationHistory);
    const context = `Recent conversation:
${history}

Current speech: "${speechResult}"

Analyze the speech and determine if we are speaking with:
1. A REAL HUMAN (e.g., a person responding naturally, having a conversation, asking questions, providing information)
2. An AUTOMATED SYSTEM (e.g., IVR menu announcements, automated prompts, system messages like "You're speaking with Walmart's automated system", menu options being read, pre-recorded messages)

IMPORTANT: 
- If the speech sounds like a pre-recorded message, menu options, or automated system announcements, it is NOT a real human.
- If the speech is natural conversation, questions, or responses from a person, it IS a real human.
- Be conservative - only say YES if you are confident this is a real person speaking.

Respond with ONLY "YES" if this is a real human, or "NO" if it's an automated system.`;

    const completion = await this.client.chat.completions.create({
      model: config.aiSettings?.model || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a call analysis assistant. Your job is to determine if we are speaking with a real human person or an automated system. Be VERY conservative - only say YES if you are confident this is a real person having a natural conversation. If it sounds like an IVR menu, automated announcement, or pre-recorded message, say NO.',
        },
        { role: 'user', content: context },
      ],
      max_tokens: 10,
      temperature: 0.3, // Lower temperature for more consistent yes/no answers
    });

    const response = completion.choices[0].message.content
      ?.trim()
      .toUpperCase();
    const isConfirmed: boolean =
      response === 'YES' || (response?.startsWith('YES') ?? false);

    console.log(`AI human confirmation: ${isConfirmed ? 'YES' : 'NO'} (response="${response}")`);

    return isConfirmed;
  }
}

// Singleton instance
const aiService = new AIService();

export default aiService;
