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
      console.log('📝 AI Service - Config received:');
      console.log(
        '  customInstructions:',
        config.customInstructions || '(none)'
      );
      console.log('  callPurpose:', config.callPurpose || '(none)');

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

      // Log a snippet of the prompt to verify customInstructions are included
      if (config.customInstructions) {
        const promptSnippet = promptResult.system
          .substring(
            promptResult.system.indexOf('[Additional call-specific guidelines]')
          )
          .substring(0, 200);
        console.log(
          '📝 Prompt snippet (custom instructions section):',
          promptSnippet
        );
      }
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
   * Confirm if a transfer request is legitimate
   * Returns true if AI confirms this is a real transfer request, false otherwise
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

The system detected a potential transfer request. Analyze the speech and determine if this is:
1. A REAL transfer request (e.g., system saying "I'm transferring you now", "Let me connect you", user explicitly asking to be transferred)
2. A FALSE POSITIVE (e.g., IVR asking "Do you want to speak with a representative?" then offering to help itself, menu options mentioning "representative", automated system describing its own features or asking questions)

IMPORTANT: If the speech is a QUESTION asking if the user wants to speak with a representative, but then offers to help itself (like "I can help with most things"), this is NOT a transfer request - it's a false positive.

Respond with ONLY "YES" if this is a legitimate transfer request, or "NO" if it's a false positive.`;

    const completion = await this.client.chat.completions.create({
      model: config.aiSettings?.model || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a call analysis assistant. Your job is to determine if a transfer request is legitimate or a false positive from an IVR menu. Be VERY conservative - only say YES if the system is ACTUALLY transferring or the user is EXPLICITLY requesting a transfer. If the IVR is asking questions or offering to help itself, say NO.',
        },
        { role: 'user', content: context },
      ],
      max_tokens: 10,
      temperature: 0.3, // Lower temperature for more consistent yes/no answers
    });

    const response = completion.choices[0].message.content?.trim().toUpperCase();
    const isConfirmed: boolean = (response === 'YES') || (response?.startsWith('YES') ?? false);
    
    console.log('🤖 AI Transfer Confirmation:', {
      speech: speechResult.substring(0, 100),
      aiResponse: response,
      confirmed: isConfirmed,
    });

    return isConfirmed;
  }
}

// Singleton instance
const aiService = new AIService();

export default aiService;
