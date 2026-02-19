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
      // If no menu options extracted, don't press (likely a fragment or incomplete menu)
      if (menuOptions.length === 0) {
        return {
          callPurpose:
            (configOrScenario as TransferConfig).callPurpose ||
            (configOrScenario as TransferConfig).description ||
            'speak with a representative',
          shouldPress: false,
          digit: null,
          matchedOption: '',
          reason: 'No menu options extracted - speech may be incomplete or a fragment',
        };
      }

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
${menuText}

Matching Rules (in priority order):
1. EXACT MATCH: If the call purpose exactly matches a menu option (e.g., "speak with a representative" matches "speak with a representative"), press that digit immediately.
2. SEMANTIC MATCH: If the call purpose is semantically similar to a menu option (e.g., "customer service" matches "support", "representative" matches "operator"), press that digit.
3. REPRESENTATIVE OPTIONS: If the call purpose is to "speak with a representative" or similar, prioritize menu options that mention: representative, operator, agent, customer service, support, or "all other questions".
4. CONTINUATION QUESTIONS: If the menu is asking a yes/no or confirmation question that continues from a previous action (e.g., "Would you like to speak with an agent? Press 1 for yes, press 2 for no"), press the option that continues toward your goal (usually "yes" or "1" to proceed).
5. EXPLICIT INSTRUCTION: If the menu explicitly says "press X" for something related to the call purpose, press that digit.
6. PHONE NUMBER REQUESTS: If the menu asks for a phone number (e.g., "enter your phone number" or "press star if you don't know"), DO NOT press star. The AI will speak the phone number instead. Only press star if the menu explicitly requires it AND we don't have the phone number available.
7. BEST AVAILABLE OPTION: If there is no perfect match but a complete menu is presented, evaluate if any option could reasonably lead to a representative:
   - If options include "all other questions", "other", "more options", "otherwise", or similar general options, press that digit.
   - If options include "yes/no" or "1/2" for service type questions, and one option seems more likely to lead to support, choose that.
   - If the menu is complete but NONE of the options relate to the call purpose AND there's no "other"/"otherwise" option, DO NOT press anything - wait for a better menu.
8. NO MATCH: Do NOT press if:
   - The menu is clearly incomplete (e.g., "Press 1 for..." with no other options)
   - The menu is complete but NONE of the options relate to your call purpose AND there's no "other"/"otherwise" option
   - All options are for specific services that don't match your purpose (e.g., "sales" and "marketing" when you need "technical support")

CRITICAL: Only press a digit when:
- There's a match (exact or semantic) for your call purpose, OR
- There's an "other"/"otherwise"/"all other questions" option, OR
- You're in a loop and need to break it by pressing the best available option

Important: When the call purpose is "speak with a representative" or similar, and a menu option mentions "representative", "operator", "agent", or "customer service", that is a MATCH. Press that digit.

IMPORTANT: 
- When custom instructions are provided, prioritize matching those over the generic call purpose.
- When call purpose is "speak with a representative", be smart about recognizing options that lead to human agents (customer care, support, help, etc.) even if they don't explicitly say "representative".
- Only press when there's a reasonable match or an "other"/"otherwise" option. Do not press just to progress if none of the options relate to your call purpose.

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
