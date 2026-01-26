"use strict";
/**
 * AI DTMF Decision Service
 * Uses AI to understand call purpose and decide which DTMF digit to press
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = __importDefault(require("openai"));
class AIDTMFService {
    constructor() {
        this.client = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    /**
     * Understand the call purpose and match it to IVR menu options
     */
    async understandCallPurposeAndPressDTMF(speech, configOrScenario, menuOptions = []) {
        try {
            const menuText = menuOptions.map(opt => `Press ${opt.digit} for ${opt.option}`).join(', ');
            const config = configOrScenario;
            const callPurpose = config.callPurpose || config.description || 'speak with a representative';
            const customInstructions = config.customInstructions || '';
            const prompt = `You are analyzing a phone call IVR menu. Your task is to:
1. Understand the PURPOSE of this call
2. Match that purpose to the correct IVR menu option
3. Decide which DTMF digit to press

Call Purpose: ${callPurpose}
${customInstructions ? `Additional Instructions: ${customInstructions}` : ''}

IVR Menu Speech: "${speech}"

Available Menu Options:
${menuText || 'No specific options extracted, but speech contains menu instructions'}

Rules:
1. FIRST understand: What is the user's purpose for calling? (e.g., order inquiry, delivery, appointment, etc.)
2. THEN match: Which menu option best matches that purpose?
3. Press the digit for the matching option
4. If no clear match, don't press anything
5. If they explicitly say "press X" or "choose X", press that digit

Respond ONLY with JSON:
{
  "callPurpose": "what the user wants (e.g., order inquiry, delivery status, appointment booking)",
  "shouldPress": true/false,
  "digit": "1" or null,
  "matchedOption": "which menu option matched",
  "reason": "brief explanation of why this digit was chosen"
}`;
            const completion = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are an intelligent IVR navigation assistant. Analyze call purpose and match to menu options. Respond only with valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 200,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            });
            const content = completion.choices[0].message.content;
            if (!content) {
                throw new Error('No response from OpenAI');
            }
            const response = JSON.parse(content);
            console.log(`   🤖 AI Analysis:`);
            console.log(`      Call Purpose: ${response.callPurpose}`);
            console.log(`      Matched Option: ${response.matchedOption || 'none'}`);
            console.log(`      Reason: ${response.reason}`);
            return response;
        }
        catch (error) {
            const err = error;
            console.error('Error in AI DTMF decision:', err);
            return {
                shouldPress: false,
                digit: null,
                reason: 'AI error',
                callPurpose: 'unknown',
                matchedOption: ''
            };
        }
    }
    /**
     * Legacy method for backward compatibility
     */
    async shouldPressDTMF(speech, scenario) {
        return await this.understandCallPurposeAndPressDTMF(speech, scenario, []);
    }
}
// Singleton instance
const aiDTMFService = new AIDTMFService();
exports.default = aiDTMFService;
//# sourceMappingURL=aiDTMFService.js.map