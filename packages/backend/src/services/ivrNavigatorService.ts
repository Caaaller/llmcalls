/**
 * IVR Navigator Service
 * Single AI call per turn — replaces aiDetectionService, aiDTMFService,
 * voiceProcessingService, and aiService with one unified decision.
 */

import Anthropic from '@anthropic-ai/sdk';
import { TransferConfig } from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { transferPrompt } from '../prompts/transfer-prompt';
import { formatConversationForAI, ActionHistoryEntry } from '../config/prompts';

const INVALID_ENTRY_PATTERNS =
  /did not recognize|invalid entry|not a valid|not recognized/i;

/**
 * Scan action history for digits that were pressed and followed by "invalid entry" responses.
 * Checks both immediate next turn AND any turn within the next 2 entries for the error message
 * (since STT sometimes splits the error and menu replay across multiple turns).
 */
function extractFailedDigits(
  actionHistory: Array<ActionHistoryEntry>,
  currentSpeech: string
): Array<string> {
  const failed = new Set<string>();

  for (let i = 0; i < actionHistory.length; i++) {
    const entry = actionHistory[i];
    if (entry.action !== 'press_digit' || !entry.digit) continue;

    // Check the next 2 turns for invalid entry messages
    for (let j = 1; j <= 2 && i + j < actionHistory.length; j++) {
      const futureEntry = actionHistory[i + j];
      if (INVALID_ENTRY_PATTERNS.test(futureEntry.ivrSpeech)) {
        failed.add(entry.digit);
        break;
      }
      // Stop looking if there's another press_digit action (that's a different attempt)
      if (futureEntry.action === 'press_digit') break;
    }
  }

  // Also check if the last pressed digit was followed by the current speech being an error
  if (actionHistory.length > 0) {
    const lastEntry = actionHistory[actionHistory.length - 1];
    if (
      lastEntry.action === 'press_digit' &&
      lastEntry.digit &&
      INVALID_ENTRY_PATTERNS.test(currentSpeech)
    ) {
      failed.add(lastEntry.digit);
    }
  }

  return [...failed];
}

export interface CallAction {
  action:
    | 'press_digit'
    | 'speak'
    | 'wait'
    | 'human_detected'
    | 'maybe_human'
    | 'hang_up'
    | 'request_info';
  digit?: string;
  speech?: string;
  requestedInfo?: string;
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
    holdDetected?: boolean;
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
  transferAnnounced?: boolean;
  awaitingHumanConfirmation?: boolean;
  skipInfoRequests?: boolean;
}

const REQUEST_INFO_RULE = `- "request_info": The system is asking for information you do NOT have (account number, member ID, etc.) and it is NOT available in your custom instructions, and it is NOT the user's phone number or email. The system will pause the call, ask the user for this info, and resume when they reply.`;

const REQUEST_INFO_SKIP_RULE = `- "request_info": DISABLED. Do NOT use this action. If the system asks for information you don't have (account number, member ID, etc.), say "I don't have that information" instead.`;

function buildCallActionSchema(skipInfoRequests: boolean): string {
  return `You must respond with valid JSON matching this schema:
{
  "action": "press_digit" | "speak" | "wait" | "human_detected" | "maybe_human" | "hang_up" | "request_info",
  "digit": "0"-"9" | "*" | "#" (required if action is "press_digit"),
  "speech": "what to say" (required if action is "speak"),
  "requestedInfo": "description of what info is needed" (required if action is "request_info"),
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
    "dataEntryMode": "dtmf" | "speech" | "none",
    "holdDetected": true/false
  }
}

Action rules:
- "press_digit": Press a DTMF digit. Use when an IVR menu is detected and you've chosen an option.
- "speak": Say something. Use when the system asks a direct question, requests data, or you need to state your purpose.
- "wait": Stay silent. Use for greetings, disclaimers, hold messages, incomplete menus.
- "maybe_human": You think a live human may be on the line. The system will ask them to confirm.
- "human_detected": A live human is CONFIRMED on the line. Use ONLY when awaitingHumanConfirmation is true and the person responded naturally to the confirmation question.
- "hang_up": Terminate the call. Use ONLY for voicemail, closed business, or dead ends.
${skipInfoRequests ? REQUEST_INFO_SKIP_RULE : REQUEST_INFO_RULE}`;
}

class IVRNavigatorService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 5,
    });
  }

  async decideAction({
    config,
    actionHistory,
    currentSpeech,
    previousMenus,
    lastPressedDTMF,
    callPurpose,
    transferAnnounced,
    awaitingHumanConfirmation,
    skipInfoRequests,
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

    const actionSchema = buildCallActionSchema(!!skipInfoRequests);

    const failedDigits = extractFailedDigits(actionHistory, currentSpeech);
    const allDigitsFailed = failedDigits.length >= 2;
    const failedDigitsWarning =
      failedDigits.length > 0
        ? `\n⚠️ FAILED DIGITS (got "invalid entry" after pressing these): ${failedDigits.join(', ')} — do NOT press these again.${allDigitsFailed ? ' ALL DTMF digits have been rejected. This IVR may not accept DTMF tones. Try SPEAKING your choice instead (e.g., say "administrative staff" or "representative" or "one") using action "speak".' : ' Try a different digit.'}\n`
        : '';

    const userMessage = `${formatConversationForAI(actionHistory)}

PREVIOUS MENUS SEEN THIS CALL:
${previousMenusSummary}
${lastPressedDTMF ? `Last DTMF pressed: ${lastPressedDTMF}` : ''}
${failedDigitsWarning}
CURRENT IVR SPEECH:
"${currentSpeech}"

CALL PURPOSE: ${callPurpose || config.callPurpose || 'speak with a representative'}
${config.customInstructions ? `CUSTOM INSTRUCTIONS: ${config.customInstructions}` : ''}
${transferAnnounced ? `TRANSFER STATE: transferAnnounced=true (the IVR said it is transferring/connecting us)` : ''}
${awaitingHumanConfirmation ? `TRANSFER STATE: awaitingHumanConfirmation=true (we asked "Hey, are you a real person?" — if they respond naturally, use human_detected)` : ''}

${actionSchema}

Analyze the current speech and decide what to do. Consider:
1. Is this a menu? Extract all options. Is the menu complete? Check PREVIOUS MENUS — if you've seen these options before, the menu IS complete. Press a digit.
2. Is the system asking a direct question? → speak
3. Is this a voicemail/closed/dead end? → hang_up
4. Does it sound like a live human (natural speech, introducing themselves)? → maybe_human (NOT human_detected, unless awaitingHumanConfirmation is true and they responded to the confirmation question)
5. Is this a greeting/disclaimer/hold music? → wait
6. If menu detected: pick the best option for the call purpose. If the system says "sorry we didn't get that" with the same menu, press NOW — you already missed it once.
7. If data entry is requested (ZIP, phone, account): determine if DTMF or speech is expected, then speak the data.
8. NEVER return "wait" more than 2 turns in a row for the same menu. If previous actions show repeated waits on menu options, press the best available digit.
9. CRITICAL: If you see FAILED DIGITS above, those digits DO NOT WORK. You MUST choose a digit NOT in the failed list. If the warning says ALL DTMF digits have been rejected, you MUST use action "speak" (NOT "press_digit") and say the option name or digit aloud (e.g., "one" or "administrative staff" or "representative").`;

    const response = await this.client.messages.create({
      model: config.aiSettings?.model || 'claude-haiku-4-5-20251001',
      system: systemPrompt.system,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 500,
      temperature: 0.3,
    });

    const block = response.content[0];
    const content = block.type === 'text' ? block.text : null;
    if (!content) {
      throw new Error('No response from IVR navigator AI');
    }

    // Extract JSON from response (Claude may wrap it in markdown code fences)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Could not parse JSON from AI response: ${content}`);
    }
    const action = JSON.parse(jsonMatch[0]) as CallAction;

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
