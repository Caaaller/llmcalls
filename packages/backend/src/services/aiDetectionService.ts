/**
 * AI Detection Service
 * Uses AI to replace brittle static functions with intelligent detection
 */

import OpenAI from 'openai';
import { MenuOption } from '../types/menu';

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

export interface IncompleteSpeechResult {
  isIncomplete: boolean;
  confidence: number;
  reason: string;
  suggestedWaitTime?: number; // seconds to wait for more speech
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
        model: 'gpt-4o-mini',
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
        model: 'gpt-4o-mini',
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
- System saying "I'm transferring you now" or "I'm now transferring you" or "transferring you to"
- "I'm now transferring you to [person/associate/representative]"
- "Put me through to an agent"
- "Transferring you to a [associate/representative/agent]"

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
        model: 'gpt-4o-mini',
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
        model: 'gpt-4o-mini',
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
- "Press 1 for sales" → "Press 1 for our sales department" (semantic match, same option)
- "Press 0 for operator" → "Press 0 to speak with an operator" (same meaning, reworded)

NOT loops (significant content changes):
- "Press 1 for sales" → "Press 1 for support" (different option, different purpose)
- "Press 1 for pharmacy" → "Press 1 for deli" (same number, different department)
- "Press 3 for financial estimate" → "Press 3 for prior authorization" (same number, but option content changed significantly - this is a NEW menu, not a loop)
- If ANY menu option's content changes significantly (not just wording, but the actual option/service), it is NOT a loop

CRITICAL: Only detect a loop if the menu options are semantically the SAME. If any option's meaning or purpose changes, it is NOT a loop, even if the structure is similar.

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
        model: 'gpt-4o-mini',
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

2. CLOSED: Business/office/warehouse/store is currently closed
   - "We are currently closed"
   - "Our office is currently closed"
   - "Our office is closed"
   - "The warehouse is now closed"
   - "The store is closed"
   - "We're closed"
   - "Outside business hours"
   - "Please call back during business hours"
   - CRITICAL: If the speech explicitly states the office/business/warehouse/store is "currently closed", "now closed", or "closed", ALWAYS terminate, even if menu options are provided. Menu options when closed are typically for automated systems (payments, balances) which don't help reach a live representative.

3. DEAD END: Call reached a dead end
   - Previous speech indicated closed
   - Current speech is empty/silent
   - Silence duration >= 5 seconds

Do NOT terminate for:
- Business hours information WITHOUT closed status (e.g., "Our hours are 9-5" without saying "closed")
- IVR menus when business is open
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
        model: 'gpt-4o-mini',
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

  /**
   * Detects if speech appears incomplete or cut off mid-sentence.
   * This helps determine if we should wait for more speech before processing.
   */
  async detectIncompleteSpeech(
    speech: string
  ): Promise<IncompleteSpeechResult> {
    try {
      const prompt = `Analyze this phone call speech transcript to determine if it appears incomplete or cut off mid-sentence.

Speech: "${speech}"

IMPORTANT: IVR menus and phone system announcements are often COMPLETE even if they don't end with punctuation or seem to continue. Only mark as incomplete if the speech is clearly cut off mid-word or mid-phrase.

An incomplete speech typically:
- Ends mid-word (e.g., "this call may be rec" instead of "this call may be recorded")
- Ends with incomplete phrases where the thought is clearly unfinished (e.g., "press 1 for" without any option mentioned)
- Ends abruptly mid-sentence without completing a thought
- Sounds like it was interrupted or cut off mid-word

Examples of INCOMPLETE speech:
- "to Bank of America, this call may be" (cut off before "recorded")
- "press 1 for" (no option mentioned)
- "thank you for calling, please" (incomplete thought)

Examples of COMPLETE speech (even if they seem to continue):
- "For calling the Home Depot. This call may be recorded or used by Home Depot and its authorized vendors." (complete sentence)
- "press 1 for sales, press 2 for support" (complete menu)
- "So, I can connect you to the right agent for help, please select from the following options on your keypad." (complete instruction)
- "For existing orders product questions or help with our website press 2." (complete menu option)
- "Press 5 for customer care, press 6." (complete menu options)
- "Today." (complete single word response)
- Any speech that ends with proper punctuation (. ! ?)
- Any speech that contains complete menu options (press X for Y)

CRITICAL: If the speech contains complete menu options (like "press 2" or "press 4"), it is COMPLETE even if more options might follow. IVR systems often list options across multiple speech segments.

Respond with JSON:
{
  "isIncomplete": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "suggestedWaitTime": 5-10 (seconds to wait if incomplete, optional)
}`;

      const completion = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at detecting incomplete speech in phone call transcripts. Respond only with valid JSON.',
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

      return JSON.parse(content) as IncompleteSpeechResult;
    } catch (error) {
      console.error('Error in AI incomplete speech detection:', error);
      // Fallback: check for common incomplete patterns
      const lower = speech.toLowerCase().trim();
      const endsWithIncomplete =
        /(may be|for|please|press|select|choose|dial)$/i.test(lower);
      const hasNoEndingPunctuation = !/[.!?]$/.test(speech.trim());
      const isShort = speech.trim().split(/\s+/).length < 5;

      return {
        isIncomplete: endsWithIncomplete || (hasNoEndingPunctuation && isShort),
        confidence: 0.6,
        reason: 'Fallback detection',
        suggestedWaitTime: 5,
      };
    }
  }
}

// Singleton instance
const aiDetectionService = new AIDetectionService();

export default aiDetectionService;
