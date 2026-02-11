/**
 * AI Detection Service
 * Uses AI to replace brittle static functions with intelligent detection
 */

import OpenAI from 'openai';
import { MenuOption } from '../utils/ivrDetector';

export interface IVRMenuDetectionResult {
  isIVRMenu: boolean;
  confidence: number;
  reason: string;
}

export interface MenuExtractionResult {
  menuOptions: MenuOption[];
  isComplete: boolean;
  confidence: number;
  reason: string;
}

export interface TransferDetectionResult {
  wantsTransfer: boolean;
  confidence: number;
  reason: string;
}

export interface HumanConfirmationResult {
  isHuman: boolean;
  confidence: number;
  reason: string;
}

export interface LoopDetectionResult {
  isLoop: boolean;
  confidence: number;
  reason: string;
  suggestedAction?: string;
}

export interface TerminationDetectionResult {
  shouldTerminate: boolean;
  reason: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
  confidence: number;
  message: string;
}

class AIDetectionService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * AI-powered IVR menu detection
   * Replaces static isIVRMenu() function
   */
  async detectIVRMenu(speech: string): Promise<IVRMenuDetectionResult> {
    try {
      const prompt = `You are analyzing phone call speech to determine if it contains an IVR (Interactive Voice Response) menu.

An IVR menu typically:
- Lists options with numbers (e.g., "Press 1 for X", "Select 2 for Y")
- Uses phrases like "press", "select", "choose", "dial", "option"
- Provides multiple choices for the caller
- May say "main menu", "options are", "following options"

Examples of IVR menus:
- "Press 1 for sales, press 2 for support"
- "For account issues, press 1. For billing, press 2"
- "Select option 1 for customer service"
- "Main menu: press 1 for orders, press 2 for returns"

Examples of NON-IVR menus:
- "Hello, how can I help you?"
- "Thank you for calling"
- "We are currently closed"
- "Please hold"

Speech to analyze: "${speech}"

Respond with JSON:
{
  "isIVRMenu": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at detecting IVR menus in phone call transcripts. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(content) as IVRMenuDetectionResult;
    } catch (error) {
      console.error('Error in AI IVR menu detection:', error);
      // Fallback to basic check
      const lower = speech.toLowerCase();
      const hasMenuPattern = /(press|select|choose|dial|option)\s*\d/i.test(
        lower
      );
      return {
        isIVRMenu: hasMenuPattern,
        confidence: 0.5,
        reason: 'AI error, using fallback',
      };
    }
  }

  /**
   * AI-powered menu option extraction
   * Replaces static extractMenuOptions() function
   */
  async extractMenuOptions(speech: string): Promise<MenuExtractionResult> {
    try {
      const prompt = `You are extracting menu options from an IVR menu speech.

Extract all menu options where each option has:
- A digit/number (0-9, *, #)
- A description of what that option does

Handle various formats:
- "Press 1 for sales, press 2 for support"
- "For sales, press 1. For support, press 2"
- "Select 1 for customer service"
- "Dial 0 for operator"
- "Option 1 is sales, option 2 is support"
- "To reach sales, dial 1"

Return ALL options found, even if the menu seems incomplete.

Speech: "${speech}"

Respond with JSON:
{
  "menuOptions": [
    {"digit": "1", "option": "sales"},
    {"digit": "2", "option": "support"}
  ],
  "isComplete": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}

If no options found, return empty array.`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at extracting menu options from IVR speech. Extract all digit-option pairs. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const result = JSON.parse(content) as MenuExtractionResult;

      // Normalize options to lowercase
      result.menuOptions = result.menuOptions.map(opt => ({
        digit: opt.digit,
        option: opt.option.toLowerCase().trim(),
      }));

      return result;
    } catch (error) {
      console.error('Error in AI menu extraction:', error);
      return {
        menuOptions: [],
        isComplete: false,
        confidence: 0.0,
        reason: 'AI error',
      };
    }
  }

  /**
   * AI-powered transfer detection
   * Replaces static wantsTransfer() function
   */
  async detectTransferRequest(
    speech: string
  ): Promise<TransferDetectionResult> {
    try {
      const prompt = `You are analyzing phone call speech to determine if the caller or system wants to transfer the call to a human representative.

Transfer requests include:
- "Transfer me to a representative"
- "I want to speak with someone"
- "Can I talk to a real person?"
- "Connect me to customer service"
- System saying "I'm transferring you now"
- "Put me through to an agent"

NOT transfer requests:
- IVR menu options like "Press 1 for customer service"
- General greetings
- Information statements

Speech: "${speech}"

Respond with JSON:
{
  "wantsTransfer": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at detecting transfer requests in phone calls. Distinguish between actual transfer requests and menu options. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(content) as TransferDetectionResult;
    } catch (error) {
      console.error('Error in AI transfer detection:', error);
      return {
        wantsTransfer: false,
        confidence: 0.0,
        reason: 'AI error',
      };
    }
  }

  /**
   * AI-powered human confirmation detection
   * Replaces static regex pattern matching
   */
  async detectHumanConfirmation(
    speech: string
  ): Promise<HumanConfirmationResult> {
    try {
      const prompt = `You are analyzing a response to the question: "Am I speaking with a real person or is this the automated system?"

Positive confirmations (human):
- "Yes", "Yeah", "Correct", "Right"
- "Yes, I'm a real person"
- "I'm human", "Real person here"
- "That's correct", "You're speaking with a human"
- "Yes, this is a real person"
- "Affirmative"

Negative responses (not human):
- "No", "This is automated"
- "This is a system"
- Any indication it's not a human

Speech: "${speech}"

Respond with JSON:
{
  "isHuman": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at detecting human confirmation responses. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(content) as HumanConfirmationResult;
    } catch (error) {
      console.error('Error in AI human confirmation detection:', error);
      return {
        isHuman: false,
        confidence: 0.0,
        reason: 'AI error',
      };
    }
  }

  /**
   * AI-powered loop detection (semantic matching)
   * Replaces static exact string matching
   */
  async detectLoop(
    currentMenu: MenuOption[],
    previousMenus: MenuOption[][]
  ): Promise<LoopDetectionResult> {
    try {
      const currentMenuStr = currentMenu
        .map(opt => `Press ${opt.digit} for ${opt.option}`)
        .join(', ');

      const previousMenusStr = previousMenus
        .map(menu =>
          menu.map(opt => `Press ${opt.digit} for ${opt.option}`).join(', ')
        )
        .join(' | ');

      const prompt = `You are detecting if an IVR menu is repeating (looping).

A loop means the SAME menu options are being presented again, even if worded slightly differently.

Examples of loops:
- "Press 1 for sales" → "Press 1 for sales" (exact match)
- "Press 1 for sales" → "Press 1 for our sales department" (semantic match)
- "Press 0 for operator" → "Press 0 to speak with an operator" (same meaning)

NOT loops:
- "Press 1 for sales" → "Press 1 for support" (different option)
- "Press 1 for pharmacy" → "Press 1 for deli" (same number, different department)

Current menu: "${currentMenuStr}"
Previous menus seen: "${previousMenusStr || 'None'}"

Respond with JSON:
{
  "isLoop": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "suggestedAction": "what to do if loop detected (optional)"
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at detecting menu loops in IVR systems. Use semantic matching, not just exact text. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(content) as LoopDetectionResult;
    } catch (error) {
      console.error('Error in AI loop detection:', error);
      return {
        isLoop: false,
        confidence: 0.0,
        reason: 'AI error',
      };
    }
  }

  /**
   * AI-powered termination detection
   * Replaces static terminationDetector functions
   */
  async detectTermination(
    speech: string,
    previousSpeech?: string,
    silenceDuration: number = 0
  ): Promise<TerminationDetectionResult> {
    try {
      const prompt = `You are analyzing phone call speech to determine if the call should be terminated.

Terminate for:
1. VOICEMAIL: System is recording a voicemail
   - "Please leave a message after the beep"
   - "Record your message"
   - "You've reached voicemail"
   - "Leave a message at the tone"

2. CLOSED: Business is closed with no menu options
   - "We are currently closed"
   - "Our office is closed"
   - "Outside business hours"
   - "Please call back during business hours"
   - Note: If closed BUT has menu options (e.g., "Press 9 for emergencies"), do NOT terminate

3. DEAD END: Call reached a dead end
   - Previous speech indicated closed
   - Current speech is empty/silent
   - Silence duration >= 5 seconds

Do NOT terminate for:
- Business hours information without closed status
- IVR menus
- Normal conversation
- Hold music or waiting

Current speech: "${speech || '(silent)'}"
Previous speech: "${previousSpeech || 'None'}"
Silence duration: ${silenceDuration} seconds

Respond with JSON:
{
  "shouldTerminate": true/false,
  "reason": "voicemail" | "closed_no_menu" | "dead_end" | null,
  "confidence": 0.0-1.0,
  "message": "explanation"
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at detecting when phone calls should be terminated. Be precise about voicemail, closed business, and dead ends. Respond only with valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return JSON.parse(content) as TerminationDetectionResult;
    } catch (error) {
      console.error('Error in AI termination detection:', error);
      return {
        shouldTerminate: false,
        reason: null,
        confidence: 0.0,
        message: 'AI error',
      };
    }
  }
}

// Singleton instance
const aiDetectionService = new AIDetectionService();

export default aiDetectionService;
