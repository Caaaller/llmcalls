/**
 * AI DTMF Decision Service
 * Uses AI to understand call purpose and decide which DTMF digit to press
 */

import OpenAI from 'openai';
import { MenuOption } from '../types/menu';

export interface TransferConfig {
  callPurpose?: string;
  customInstructions?: string;
  description?: string;
}

export interface Scenario {
  description?: string;
}

export interface DTMFDecision {
  callPurpose: string;
  shouldPress: boolean;
  digit: string | null;
  matchedOption: string;
  reason: string;
}

class AIDTMFService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Understand the call purpose and match it to IVR menu options
   */
  async understandCallPurposeAndPressDTMF(
    speech: string,
    configOrScenario: TransferConfig | Scenario,
    menuOptions: MenuOption[] = []
  ): Promise<DTMFDecision> {
    try {
      const menuText = menuOptions
        .map(opt => `Press ${opt.digit} for ${opt.option}`)
        .join(', ');

      const config = configOrScenario as TransferConfig;
      const callPurpose =
        config.callPurpose ||
        config.description ||
        'speak with a representative';
      const customInstructions = config.customInstructions || '';

      const prompt = `You are analyzing a phone call IVR menu. Your task is to:
1. Understand the PURPOSE of this call
2. Match that purpose to the correct IVR menu option
3. Decide which DTMF digit to press

Call Purpose: ${callPurpose}
${customInstructions ? `Custom Instructions (PRIORITY): ${customInstructions}` : ''}

IVR Menu Speech: "${speech}"

Available Menu Options:
${menuText || 'No specific options extracted, but speech contains menu instructions'}

Matching Rules (in priority order):
1. EXACT MATCH: If the call purpose exactly matches a menu option (e.g., "speak with a representative" matches "speak with a representative"), press that digit immediately.
2. SEMANTIC MATCH: If the call purpose is semantically similar to a menu option (e.g., "customer service" matches "support", "representative" matches "operator"), press that digit.
3. REPRESENTATIVE OPTIONS: If the call purpose is to "speak with a representative" or similar, prioritize menu options that mention: representative, operator, agent, customer service, support, or "all other questions".
4. EXPLICIT INSTRUCTION: If the menu explicitly says "press X" for something related to the call purpose, press that digit.
5. BEST AVAILABLE OPTION: If there is no perfect match but a complete menu is presented, you MUST still press a digit to progress. Choose the option most likely to lead to a representative or help:
   - If options include "yes/no" or "1/2" for service type questions, choose the option that seems most likely to lead to support (often "yes" or the first option).
   - If options include "all other questions", "other", "more options", or similar, choose that.
   - If unsure, choose the option that seems most general or likely to connect to a person.
6. NO MATCH: Only if the menu is clearly incomplete (e.g., "Press 1 for..." with no other options) should you not press anything.

CRITICAL: When a COMPLETE menu is presented (e.g., "Press 1 for X, Press 2 for Y"), you MUST press a digit. Do not wait for a perfect match. Always choose the best available option to progress through the IVR system.

Important: When the call purpose is "speak with a representative" or similar, and a menu option mentions "representative", "operator", "agent", or "customer service", that is a MATCH. Press that digit.

IMPORTANT: 
- When custom instructions are provided, prioritize matching those over the generic call purpose.
- When call purpose is "speak with a representative", be smart about recognizing options that lead to human agents (customer care, support, help, etc.) even if they don't explicitly say "representative".
- When a complete menu is shown but no option perfectly matches, still press the best available option to continue navigation.

Respond ONLY with JSON:
{
  "callPurpose": "what the user wants (e.g., order inquiry, delivery status, appointment booking, how to become a vendor)",
  "shouldPress": true/false,
  "digit": "1" or null,
  "matchedOption": "which menu option matched",
  "reason": "brief explanation of why this digit was chosen"
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an intelligent IVR navigation assistant. Analyze call purpose and match to menu options. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const response: DTMFDecision = JSON.parse(content);
      console.log(`   🤖 AI Analysis:`);
      console.log(`      Call Purpose: ${response.callPurpose}`);
      console.log(`      Matched Option: ${response.matchedOption || 'none'}`);
      console.log(`      Reason: ${response.reason}`);
      return response;
    } catch (error) {
      const err = error as Error;
      console.error('Error in AI DTMF decision:', err);
      return {
        shouldPress: false,
        digit: null,
        reason: 'AI error',
        callPurpose: 'unknown',
        matchedOption: '',
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async shouldPressDTMF(
    speech: string,
    scenario: Scenario
  ): Promise<DTMFDecision> {
    return await this.understandCallPurposeAndPressDTMF(speech, scenario, []);
  }
}

// Singleton instance
const aiDTMFService = new AIDTMFService();

export default aiDTMFService;
