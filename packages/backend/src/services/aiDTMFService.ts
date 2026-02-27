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
      // If no menu options extracted, press 1 as safest fallback
      if (menuOptions.length === 0) {
        return {
          callPurpose:
            (configOrScenario as TransferConfig).callPurpose ||
            (configOrScenario as TransferConfig).description ||
            'speak with a representative',
          shouldPress: true,
          digit: '1',
          matchedOption: 'fallback - no menu detected',
          reason: 'No menu options extracted - pressing 1 as safest fallback',
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

CRITICAL RULE: YOU MUST ALWAYS PRESS A DIGIT WHEN AN IVR MENU IS PRESENT.
Do not wait for a "better" menu - it may never come.

Matching Rules (in priority order):
1. EXACT MATCH: If the call purpose exactly matches a menu option, press that digit.
2. SEMANTIC MATCH: If similar (e.g., "customer service" matches "support"), press that digit.
3. REPRESENTATIVE OPTIONS: Prioritize: representative, operator, agent, customer service, support, "all other questions".
4. FALLBACK: If NO option matches your purpose, you MUST press the FIRST digit mentioned in the menu.
   - Example: If menu says "Press 1 for X, Press 2 for Y" → press 1
   - NEVER press 0 unless 0 is explicitly listed in the menu!
   - The first digit is always the safest fallback
5. CONTINUATION: If menu asks "press 1 for yes, press 2 for no", always press to continue.

ABSOLUTELY CRITICAL:
- NEVER say "None of the options match" and refuse to press
- NEVER wait for a "better" menu
- ALWAYS press the FIRST available digit when no match
- ALWAYS press something when menu options are present
- If uncertain, press 0 (operator is usually the safest bet)

Respond ONLY with JSON:
{
  "callPurpose": "what the user wants",
  "shouldPress": true,
  "digit": "0" or "1" or "2" etc,
  "matchedOption": "which menu option matched (or 'fallback to 0' or 'first option')",
  "reason": "brief explanation"
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
      console.log(
        `AI DTMF decision: digit=${response.digit} matched="${response.matchedOption}" reason="${response.reason}"`
      );
      return response;
    } catch (error) {
      const err = error as Error;
      console.error('Error in AI DTMF decision:', err);
      // Fallback: press 1 on error (safest fallback)
      return {
        shouldPress: true,
        digit: '1',
        reason: 'AI error - fallback to first option',
        callPurpose: 'unknown',
        matchedOption: 'fallback on error',
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
