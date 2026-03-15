/**
 * IVR Navigator Service
 * Single AI call per turn — replaces aiDetectionService, aiDTMFService,
 * voiceProcessingService, and aiService with one unified decision.
 */

import OpenAI from 'openai';
import { TransferConfig } from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { transferPrompt } from '../prompts/transfer-prompt';
import { formatConversationForAI, ActionHistoryEntry } from '../config/prompts';

export interface CallAction {
  action: 'press_digit' | 'speak' | 'wait' | 'human_detected' | 'hang_up';
  digit?: string;
  speech?: string;
  reason: string;
  detected: {
    isIVRMenu: boolean;
    menuOptions: Array<{ digit: string; option: string }>;
    isMenuComplete: boolean;
    loopDetected: boolean;
    shouldTerminate: boolean;
    terminationReason?: string;
    transferRequested: boolean;
    transferConfidence?: number;
    dataEntryMode?: 'dtmf' | 'speech' | 'none';
  };
}

interface DecideActionParams {
  config: TransferConfig;
  conversationHistory: Array<{ type: string; text: string }>;
  actionHistory: Array<ActionHistoryEntry>;
  currentSpeech: string;
  previousMenus: Array<Array<MenuOption>>;
  lastPressedDTMF?: string;
  callPurpose?: string;
}

const CALL_ACTION_SCHEMA = `You must respond with valid JSON matching this schema:
{
  "action": "press_digit" | "speak" | "wait" | "human_detected" | "hang_up",
  "digit": "0"-"9" | "*" | "#" (required if action is "press_digit"),
  "speech": "what to say" (required if action is "speak"),
  "reason": "brief explanation of your decision",
  "detected": {
    "isIVRMenu": true/false,
    "menuOptions": [{"digit": "1", "option": "description"}, ...],
    "isMenuComplete": true/false,
    "loopDetected": true/false,
    "shouldTerminate": true/false,
    "terminationReason": "voicemail" | "closed_no_menu" | "dead_end" | null,
    "transferRequested": true/false,
    "transferConfidence": 0.0-1.0,
    "dataEntryMode": "dtmf" | "speech" | "none"
  }
}

Action rules:
- "press_digit": Press a DTMF digit. Use when an IVR menu is detected and you've chosen an option.
- "speak": Say something. Use when the system asks a direct question, requests data, or you need to state your purpose.
- "wait": Stay silent. Use for greetings, disclaimers, hold messages, incomplete menus.
- "human_detected": A live human representative is on the line. The system will auto-transfer.
- "hang_up": Terminate the call. Use ONLY for voicemail, closed business, or dead ends.`;

class IVRNavigatorService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async decideAction({
    config,
    actionHistory,
    currentSpeech,
    previousMenus,
    lastPressedDTMF,
    callPurpose,
  }: DecideActionParams): Promise<CallAction> {
    const systemPrompt = transferPrompt['transfer-only'](config, '', false);

    const previousMenusSummary =
      previousMenus.length > 0
        ? previousMenus
            .map(
              (menu, i) =>
                `Menu ${i + 1}: ${menu.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}`
            )
            .join('\n')
        : 'None';

    const userMessage = `${formatConversationForAI(actionHistory)}

PREVIOUS MENUS SEEN THIS CALL:
${previousMenusSummary}
${lastPressedDTMF ? `Last DTMF pressed: ${lastPressedDTMF}` : ''}

CURRENT IVR SPEECH:
"${currentSpeech}"

CALL PURPOSE: ${callPurpose || config.callPurpose || 'speak with a representative'}
${config.customInstructions ? `CUSTOM INSTRUCTIONS: ${config.customInstructions}` : ''}

${CALL_ACTION_SCHEMA}

Analyze the current speech and decide what to do. Consider:
1. Is this a menu? Extract all options. Is the menu complete (2+ options and naturally concludes)?
2. Is the system asking a direct question? → speak
3. Is this a voicemail/closed/dead end? → hang_up
4. Is a human speaking naturally? → human_detected
5. Is this a greeting/disclaimer/hold? → wait
6. If menu detected: pick the best option for the call purpose. If a loop is detected (same menu as before), wait instead of pressing the same digit again.
7. If data entry is requested (ZIP, phone, account): determine if DTMF or speech is expected, then speak the data.`;

    const completion = await this.client.chat.completions.create({
      model: config.aiSettings?.model || 'gpt-5.4',
      messages: [
        { role: 'system', content: systemPrompt.system },
        { role: 'user', content: userMessage },
      ],
      max_completion_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('No response from IVR navigator AI');
    }

    const action = JSON.parse(content) as CallAction;

    // Normalize menu options to lowercase
    if (action.detected?.menuOptions) {
      action.detected.menuOptions = action.detected.menuOptions.map(opt => ({
        digit: opt.digit,
        option: opt.option.toLowerCase().trim(),
      }));
    }

    return action;
  }
}

const ivrNavigatorService = new IVRNavigatorService();

export default ivrNavigatorService;
