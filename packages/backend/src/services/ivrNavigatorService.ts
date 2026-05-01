/**
 * IVR Navigator Service
 * Single AI call per turn — replaces aiDetectionService, aiDTMFService,
 * voiceProcessingService, and aiService with one unified decision.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { TransferConfig } from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { transferPrompt } from '../prompts/transfer-prompt';
import { formatConversationForAI, ActionHistoryEntry } from '../config/prompts';
import callStateManager from './callStateManager';

const INVALID_ENTRY_PATTERNS =
  /did not recognize|invalid entry|not a valid|not recognized/i;

const DIGIT_WORD_MAP: Record<string, Array<string>> = {
  '0': ['zero', 'oh'],
  '1': ['one'],
  '2': ['two'],
  '3': ['three'],
  '4': ['four'],
  '5': ['five'],
  '6': ['six'],
  '7': ['seven'],
  '8': ['eight'],
  '9': ['nine'],
  '*': ['star', 'asterisk'],
  '#': ['pound', 'hash'],
};

/**
 * Extract the first balanced, string-aware JSON object from `content`.
 * Returns null if no complete object is found. Unlike /\{[\s\S]*\}/ this
 * stops at the matching closing brace, so trailing prose (including prose
 * containing additional `}` characters) does not break JSON.parse.
 */
export function extractFirstJsonObject(content: string): string | null {
  const start = content.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < content.length; i++) {
    const ch = content[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(start, i + 1);
      }
    }
  }

  return null;
}

function transcriptContainsDigit(transcript: string, digit: string): boolean {
  const lower = transcript.toLowerCase();
  if (lower.includes(digit)) return true;
  const words = DIGIT_WORD_MAP[digit] || [];
  return words.some(w => new RegExp(`\\b${w}\\b`).test(lower));
}

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
    | 'maybe_human_unclear'
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
    /**
     * TRUE when the speech contains a personal introduction indicating a real human
     * agent has picked up: phrases like "My name is [Name]", "This is [Name]",
     * "You've reached [Name]", "I'm [Name]", "[Name] speaking".
     * Used to ensure the AI flags human pickups consistently, independent of the
     * action it returns. If this is true, the backend enforces action=human_detected.
     */
    humanIntroDetected?: boolean;
  };
}

/**
 * Incrementally extracts the value of the "speech" field from streaming JSON
 * deltas. Operates as a character-level state machine — no JSON parser needed
 * during streaming.
 *
 * The JSON structure the AI returns looks like:
 *   {"action": "speak", "speech": "...", "reason": "...", "detected": {...}}
 * The order of keys is not guaranteed, so we scan for the literal `"speech"`
 * key in the stream.
 *
 * States:
 *   - SEEKING_KEY:   scanning for the literal `"speech"` key
 *   - SEEKING_COLON: found key, waiting for `:`
 *   - SEEKING_QUOTE: found colon, waiting for opening `"`
 *   - IN_VALUE:      inside the speech string value — emit chars
 *   - DONE:          closing `"` found, stop emitting
 */
const enum SpeechExtractState {
  SEEKING_KEY,
  SEEKING_COLON,
  SEEKING_QUOTE,
  IN_VALUE,
  DONE,
}

export class SpeechFieldExtractor {
  private state = SpeechExtractState.SEEKING_KEY;
  private keyBuffer = '';
  private escape = false;
  private readonly targetKey = '"speech"';

  /**
   * Feed a delta string into the extractor. Returns any speech characters
   * found in this delta (may be empty if not yet inside the value).
   */
  extract(delta: string): string {
    if (this.state === SpeechExtractState.DONE) return '';

    let output = '';

    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i];

      switch (this.state) {
        case SpeechExtractState.SEEKING_KEY:
          this.keyBuffer += ch;
          if (this.keyBuffer.length > this.targetKey.length) {
            this.keyBuffer = this.keyBuffer.slice(-this.targetKey.length);
          }
          if (this.keyBuffer === this.targetKey) {
            this.state = SpeechExtractState.SEEKING_COLON;
            this.keyBuffer = '';
          }
          break;

        case SpeechExtractState.SEEKING_COLON:
          if (ch === ':') this.state = SpeechExtractState.SEEKING_QUOTE;
          break;

        case SpeechExtractState.SEEKING_QUOTE:
          if (ch === '"') this.state = SpeechExtractState.IN_VALUE;
          break;

        case SpeechExtractState.IN_VALUE:
          if (this.escape) {
            switch (ch) {
              case 'n':
                output += '\n';
                break;
              case 't':
                output += '\t';
                break;
              case 'r':
                output += '\r';
                break;
              case '"':
                output += '"';
                break;
              case '\\':
                output += '\\';
                break;
              default:
                output += ch;
                break;
            }
            this.escape = false;
          } else if (ch === '\\') {
            this.escape = true;
          } else if (ch === '"') {
            this.state = SpeechExtractState.DONE;
          } else {
            output += ch;
          }
          break;

        case SpeechExtractState.DONE:
          return output;
      }
    }

    return output;
  }

  isDone(): boolean {
    return this.state === SpeechExtractState.DONE;
  }
}

/**
 * Streaming JSON parser that watches for `"action": "press_digit"` AND
 * `"digit": "X"` in the model's output. Once BOTH are seen with a valid
 * digit, fires once with the digit so we can fire DTMF speculatively
 * (~1.5-3s before the stream completes). Single-shot per instance.
 *
 * Tolerant of field order: handles either action-then-digit or
 * digit-then-action. Returns true once the digit is committed; subsequent
 * extract() calls are no-ops.
 */
export class PressDigitExtractor {
  private fired = false;
  private actionIsPressDigit: boolean | null = null;
  private digit: string | null = null;
  private buffer = '';

  /**
   * Feed a delta. Returns the digit if BOTH conditions are now satisfied
   * (this is a press_digit action AND a valid digit has been parsed). Null
   * otherwise. Once a digit is returned, all subsequent calls return null.
   */
  extract(delta: string): string | null {
    if (this.fired) return null;
    this.buffer += delta;
    // Cap buffer to avoid unbounded growth on long streams.
    if (this.buffer.length > 4096) {
      this.buffer = this.buffer.slice(-2048);
    }

    if (this.actionIsPressDigit === null) {
      const actionMatch = this.buffer.match(/"action"\s*:\s*"([^"]+)"/);
      if (actionMatch) {
        this.actionIsPressDigit = actionMatch[1] === 'press_digit';
      }
    }

    if (this.digit === null) {
      const digitMatch = this.buffer.match(/"digit"\s*:\s*"([0-9*#])"/);
      if (digitMatch) {
        this.digit = digitMatch[1];
      }
    }

    if (this.actionIsPressDigit === true && this.digit !== null) {
      this.fired = true;
      return this.digit;
    }
    // If action arrived and is NOT press_digit, we can short-circuit and
    // ignore any digit field that might appear later.
    if (this.actionIsPressDigit === false) {
      this.fired = true;
      return null;
    }
    return null;
  }
}

export interface StreamingCallbacks {
  onSpeechChunk: (text: string) => void;
  onSpeechDone: () => void;
  /** Fires when streaming JSON has a confident press_digit + digit BEFORE
   * the stream completes. Used to fire DTMF speculatively. Single-shot. */
  onSpeculativeDigit?: (digit: string) => void;
}

export interface StreamingResult {
  action: CallAction;
  speechStreamed: boolean;
}

interface DecideActionParams {
  config: TransferConfig;
  conversationHistory: Array<{ type: string; text: string }>;
  actionHistory: Array<ActionHistoryEntry>;
  currentSpeech: string;
  previousMenus: Array<Array<MenuOption>>;
  lastPressedDTMF?: string;
  callPurpose?: string;
  awaitingHumanConfirmation?: boolean;
  awaitingHumanClarification?: boolean;
  skipInfoRequests?: boolean;
  requireLiveAgent?: boolean;
}

const REQUEST_INFO_RULE = `- "request_info": The system is asking for information you do NOT have (account number, member ID, etc.) and it is NOT available in your custom instructions, and it is NOT the user's phone number or email. The system will pause the call, ask the user for this info, and resume when they reply.`;

const REQUEST_INFO_SKIP_RULE = `- "request_info": DISABLED. Do NOT use this action. If the system asks for information you don't have (account number, member ID, etc.), say "I don't have that information" instead.`;

function buildCallActionSchema(skipInfoRequests: boolean): string {
  return `You must respond with valid JSON matching this schema. CRITICAL: emit fields in the EXACT order shown below — "speech" MUST come first so streaming TTS can start as early as possible:
{
  "speech": "what to say" (required if action is "speak", otherwise empty string ""),
  "action": "press_digit" | "speak" | "wait" | "human_detected" | "maybe_human" | "maybe_human_unclear" | "hang_up" | "request_info",
  "digit": "0"-"9" | "*" | "#" (required if action is "press_digit"),
  "requestedInfo": "description of what info is needed" (required if action is "request_info"),
  "reason": "brief explanation of your decision",
  "detected": {
    "isIVRMenu": true/false,
    "menuOptions": [{"digit": "1", "option": "description"}, ...],
    "isMenuComplete": true/false,
    "loopDetected": true/false,
    "shouldTerminate": true/false,
    "terminationReason": "voicemail" | "closed_no_menu" | "dead_end" | null,
    "transferRequested": true/false,  // Set TRUE only when the IVR announces it is transferring us ("I'm transferring you now", "Please hold while I connect you", "One moment while I transfer you"). Do NOT set true just because an IVR menu mentions a "representative" option or because we're in confirmation mode. An IVR menu offering choices is NOT a transfer announcement.
    "transferConfidence": 0.0-1.0,
    "dataEntryMode": "dtmf" | "speech" | "none",
    "holdDetected": true/false,  // Set TRUE only when the CURRENT speech explicitly signals we are being held in a queue. Required signals (at least one): "please hold", "continue to hold", "stay on the line", "your call is important to us", "a representative/agent will be with you shortly", "estimated wait time", "you are caller number", "all agents are busy", "next available agent/representative". Set FALSE for anything else, including scripted-sounding speech without these signals — greetings ("Welcome to X", "Thank you for calling X", "Hello, this is X"), recording/monitoring disclaimers ("This call may be recorded", "...monitored for quality", "...analyzed by X", "We may use AI technology..."), data entry prompts ("Please enter your...", "Say your account number", "Enter your ZIP followed by pound"), IVR menus ("Press 1 for... Press 2 for..."), short transitions ("One moment please", "Thank you", "Got it"), privacy/legal notices ("By continuing you agree to...", "Your information is protected under..."). Examples: "Welcome to Wells Fargo. This call may be recorded..." → false (greeting + disclaimer, no hold signal). "Please hold while I connect you to the next available representative." → true. "All of our agents are currently busy. Please stay on the line." → true. "Thank you for calling Acme. How can I help you today?" → false. "This call may be monitored or recorded for quality and training purposes." → false. "You are caller number 3. Estimated wait time is 5 minutes." → true. "Please enter your account number followed by pound." → false.
    "humanIntroDetected": true/false  // Set TRUE whenever the speech contains a personal introduction with a REAL PERSON'S FIRST NAME. Patterns: "My name is [FirstName]", "This is [FirstName]", "You've reached [FirstName]", "I'm [FirstName]", "[FirstName] speaking", "You're connected to [FirstName]", "You're speaking with [FirstName]". The slot MUST be a proper given name (Sarah, Jeremy, Abdul, Mary, Javier, Kit, Laura, Mark, Zoma, etc.). DEPARTMENTS/ROLES DO NOT COUNT — "customer service", "billing", "the front desk", "tech support", "sales", "this department", "an agent", "a representative" are NOT names. Also not names: "correct", "about", "right". Set FALSE if the speech only has a role/department with no first name ("Hi, this is customer service" → false).
  }
}

Action rules:
- "press_digit": Press a DTMF digit. Use when an IVR menu is detected and you've chosen an option. MANDATORY: if you set detected.isIVRMenu=true in your response, your action MUST be either "press_digit" (with a digit) or "wait" (if menu is incomplete). Never "speak" a DTMF option out loud when you've identified a menu — press the digit.
- "speak": Say something. Use when the system asks a direct question, requests data, or you need to state your purpose. Do NOT use speak when detected.isIVRMenu=true.
- "wait": Stay silent. Use for greetings, disclaimers, hold messages, incomplete menus.
- "maybe_human": You think a live human MIGHT be on the line. Use this for ANY first-hearing human-ish speech, including CLEAR name intros ("My name is Sarah", "This is Mike"), short greetings ("Hello?"), or conversational speech. The system will ask "Am I speaking with a live agent?" — that confirmation step is MANDATORY before transfer. Do NOT skip confirmation even for clear names. CRITICAL: when action is "maybe_human", "maybe_human_unclear", or "human_detected", the "speech" field MUST be an empty string ("") — never the call purpose, never an answer to the human's question, never anything. The system speaks its own canned question/bridge text in these branches; any speech you emit will be spoken TO the live human on the line BEFORE our confirmation question, which is confusing and delays the handoff.
- "human_detected": A real human is CONFIRMED on the line. Use when awaitingHumanConfirmation=true OR awaitingHumanClarification=true AND the speech is a natural human response — "yes", "yeah", "no", "hello", "hi", "who is this", "what?", "huh?", "uh yeah", "can you hold", "are you a live agent", "what are you calling about", "this is Sarah yes", "I'm here", filler words with real English words, confused/hesitant speech, or questions pushed back at us. ERR GENEROUSLY in confirmation mode — default to human_detected unless speech is clearly an IVR menu, scripted hold, or bot self-ID. ONLY pure non-word sounds ("mmhm", just "uh", just "hm") → maybe_human_unclear. NOTE: do NOT return human_detected when awaitingHumanConfirmation/Clarification are BOTH false — use maybe_human in that case even for clear name intros.
- "maybe_human_unclear": Response to our confirmation question was genuinely ambiguous (unintelligible mumble, just "mmhm", unclear noise). Use ONLY when awaitingHumanConfirmation is true and the response is truly ambiguous — not clearly human and not clearly IVR. The system will ask a more direct question.
- "hang_up": Terminate the call. Use ONLY for voicemail, closed business, or dead ends.
${skipInfoRequests ? REQUEST_INFO_SKIP_RULE : REQUEST_INFO_RULE}`;
}

type LLMProvider = 'anthropic' | 'openai' | 'gemini';

const CLAUDE_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// Gemini 2.5 Flash is the current generally-available Flash model.
// Gemini 2.0 Flash returned `free_tier_input_token_count limit: 0` on the
// active project (project 941094625696); 2.5 Flash works on the same key.
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: GeminiUsage;
}

// Parse Google's `Please retry in Xs.` from a 429 body. Returns ms.
function parseGeminiRetryDelayMs(body: string): number | null {
  const m = body.match(/retry in ([\d.]+)s/i);
  if (!m) return null;
  const seconds = parseFloat(m[1]);
  if (!isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1000) + 250;
}

async function callGeminiNonStreaming({
  apiKey,
  model,
  systemMessage,
  userMessage,
}: {
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
}): Promise<{ content: string; usage: GeminiUsage }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemMessage }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as GeminiResponse;
      const content =
        data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') ||
        '';
      return { content, usage: data.usageMetadata || {} };
    }
    const text = await res.text();
    if (res.status === 429 && attempt < maxRetries) {
      const delayMs = parseGeminiRetryDelayMs(text) ?? (attempt + 1) * 5000;
      console.log(
        `Gemini 429 — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`
      );
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  throw new Error('Gemini API: unreachable retry exhaustion');
}

async function* streamGemini({
  apiKey,
  model,
  systemMessage,
  userMessage,
}: {
  apiKey: string;
  model: string;
  systemMessage: string;
  userMessage: string;
}): AsyncGenerator<{ delta?: string; usage?: GeminiUsage }, void, unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemMessage }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 800,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const maxRetries = 3;
  let res: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok && res.body) break;
    const text = await res.text().catch(() => '');
    if (res.status === 429 && attempt < maxRetries) {
      const delayMs = parseGeminiRetryDelayMs(text) ?? (attempt + 1) * 5000;
      console.log(
        `Gemini stream 429 — retry ${attempt + 1}/${maxRetries} in ${delayMs}ms`
      );
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    throw new Error(`Gemini stream error ${res.status}: ${text}`);
  }
  if (!res || !res.body) {
    throw new Error('Gemini stream: no body after retries');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as GeminiResponse;
        const delta = parsed.candidates?.[0]?.content?.parts
          ?.map(p => p.text || '')
          .join('');
        if (delta) yield { delta };
        if (parsed.usageMetadata) yield { usage: parsed.usageMetadata };
      } catch {
        // ignore malformed line
      }
    }
  }
}

class IVRNavigatorService {
  private openaiClient: OpenAI;
  private anthropicClient: Anthropic;

  constructor() {
    this.openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 5,
    });
    this.anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxRetries: 5,
    });
  }

  private getProvider(): LLMProvider {
    const raw = (process.env.IVR_LLM_PROVIDER || 'anthropic').toLowerCase();
    if (raw === 'openai') return 'openai';
    if (raw === 'gemini' || raw === 'google') return 'gemini';
    return 'anthropic';
  }

  /**
   * Build the system+user messages for the AI call. Shared between the
   * non-streaming (decideAction) and streaming (decideActionStreaming) paths
   * so they send byte-identical prompts.
   */
  private buildMessages({
    config,
    actionHistory,
    currentSpeech,
    previousMenus,
    lastPressedDTMF,
    callPurpose,
    awaitingHumanConfirmation,
    awaitingHumanClarification,
    skipInfoRequests,
    requireLiveAgent,
  }: DecideActionParams): { systemMessage: string; userMessage: string } {
    const systemPrompt = transferPrompt['transfer-only'](
      { ...config, requireLiveAgent },
      '',
      false
    );

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

    // Detect rut — if AI said the same thing 2+ times recently and IVR keeps asking
    const recentSpeeches = actionHistory
      .slice(-4)
      .filter(a => a.action === 'speak' && a.speech);
    let rutWarning = '';
    if (recentSpeeches.length >= 2) {
      const lastSpeech =
        recentSpeeches[recentSpeeches.length - 1]?.speech
          ?.trim()
          .toLowerCase() || '';
      const repeats = recentSpeeches.filter(
        a => a.speech?.trim().toLowerCase() === lastSpeech
      ).length;
      if (repeats >= 2) {
        rutWarning = `\n⚠️ STUCK IN A RUT: You've said "${lastSpeech}" ${repeats} times and the system keeps asking for more. STOP repeating yourself. Try a DIFFERENT response — pick from the IVR's offered options, rephrase your request, or try a different category.\n`;
      }
    }

    const userMessage = `${formatConversationForAI(actionHistory)}

PREVIOUS MENUS SEEN THIS CALL:
${previousMenusSummary}
${lastPressedDTMF ? `Last DTMF pressed: ${lastPressedDTMF}` : ''}
${failedDigitsWarning}${rutWarning}
CURRENT IVR SPEECH:
"${currentSpeech}"

CALL PURPOSE: ${callPurpose || config.callPurpose || 'speak with a representative'}
${config.customInstructions ? `CUSTOM INSTRUCTIONS: ${config.customInstructions}` : ''}
${
  requireLiveAgent && !awaitingHumanConfirmation && !awaitingHumanClarification
    ? `⚠️ requireLiveAgent=true: this call REQUIRES confirming a live human before any transfer. On FIRST-HEARING conversational speech that is NOT a clearly-automated IVR menu/hold/disclaimer, return maybe_human — even when the speaker is asking a question like "How can I help you?" or "What's your name?". Do NOT shortcut to answering with the call purpose; the confirmation question MUST be asked before purpose. This rule overrides step 5 below for first-hearing human-style speech.\n\n`
    : ''
}${
      awaitingHumanConfirmation
        ? `⚠️ CRITICAL — awaitingHumanConfirmation=true: We already asked "Am I speaking with a live agent?" Default is human_detected for ANYTHING that sounds even slightly human.
- Human-sounding responses (→ human_detected): "Yes", "Yeah", "Yep", "Sure", "No", "Hello", "Hi", "Hey", "Who is this?", "What?", "Huh?", "I'm here", "Can you hold", "Yes can you hold on", "Uh yeah sorry", "What are you calling about", "Are you a live agent", any sentence with real English words — even short, hesitant, or confused speech. ERR GENEROUSLY toward human_detected.
- ONLY these override the human_detected bias:
  * Clear IVR menu: "press 1 for X, press 2 for Y" → press_digit
  * Scripted automated hold prefix: "please hold while", "your call is important to us", "a representative will be with you shortly", "estimated wait time is", "you are caller number" → wait
  * Bot self-ID: "I'm a virtual assistant", "I am an automated system", "I'm an AI" → speak/wait (not human)
  * Pure non-word sound with NO real words ("mmhm", "mm", "uh", "hm", "um", trailing "..." only) → maybe_human_unclear
- When in doubt: human_detected. A caller asking "can you hold on" IS a human — transfer them.`
        : ''
    }
${awaitingHumanClarification ? `⚠️ CRITICAL — awaitingHumanClarification=true: We already asked TWICE. ANY response that is not clearly an automated IVR system MUST return human_detected. Be extremely generous — if there's any chance it's a human, use human_detected.` : ''}

${actionSchema}

Analyze the current speech and decide what to do. Consider IN THIS ORDER:
1. Is awaitingHumanConfirmation=true or awaitingHumanClarification=true in the context below? → CONFIRMATION MODE. We just asked "Am I speaking with a live agent?". Classify the response:
   a) CLEARLY AUTOMATED (→ wait / press_digit / speak, NOT human_detected):
      - Contains an IVR menu ("For X press 1, for Y press 2") → press_digit the best option (see menu rules below)
      - Scripted hold/queue message ("please hold", "please continue to hold", "a representative will be with you shortly", "your call is important to us", "estimated wait time", "next available agent")
      - Self-identifying as bot ("I am an automated system", "I'm a virtual assistant", "I'm an AI")
      - Post-hold "please hold" / "still holding" text
      → Return the appropriate non-human action. Do NOT treat as human just because confirmation is pending.
   b) NATURAL HUMAN RESPONSE (→ human_detected, transfer):
      - Affirmative: "Yes", "Yes you are", "Yeah", "Yep", "Sure"
      - Greeting: "Hello", "Hi", "Hey"
      - Presence: "I'm here", "I'm still here"
      - Confused/questioning: "Who is this?", "What?", "Huh?", "uh... yes..."
      - Conversational acknowledgment: "Can you hold", "Yes, you are. How can I help you?"
      - Any natural non-scripted speech that is NOT one of the automated signals above
   c) GENUINELY UNINTELLIGIBLE (just "mmhm", unclear noise): maybe_human_unclear
   Rule of thumb: automated signals WIN over the "in confirmation mode" bias. A scripted "A representative will be with you shortly" is NOT human_detected just because confirmation is active.
2. Is this a menu? Extract all options. Is the menu complete? Check PREVIOUS MENUS — if you've seen these options before, the menu IS complete. Press a digit.
3. Does speech contain a PERSONAL INTRODUCTION or sound even slightly human, AND awaitingHumanConfirmation/Clarification is FALSE? → maybe_human (we MUST ask the confirmation question before transfer — no fast-path). Patterns that trigger maybe_human:
   - Proper first name intro: "My name is Sarah", "This is Mike", "You've reached Kit", "Jeremy speaking", "You're connected to Zoma" — set humanIntroDetected=true AND return maybe_human (NOT human_detected).
   - Role-only intro without a name: "Hi, this is customer service", "Billing department, how may I help" — maybe_human.
   - Short line-check greeting: "Hello?", "Hi?", "Are you still there?", "Hello, are you there?" — maybe_human.
   - Casual conversational speech: "Yeah, what do you need?", "Can I get your account number?" — maybe_human.
   CRITICAL: Do NOT return human_detected on first-hearing speech. human_detected is ONLY valid when awaitingHumanConfirmation=true (see step 1). Even a clear name like "My name is Jeremy" must route through maybe_human → confirmation → human_detected.
   CRITICAL: If the speech contains a name AND a question ("May I have your name?", "How can I help?"), IGNORE the question — return maybe_human, do NOT answer with call purpose.
4. Is the speech a SHORT ISOLATED GREETING with no context? Examples: "Hello?", "Hi?", "Yeah?", "Yes?", "Anyone there?", "Hello, are you there?", "Hello, are you still there?", "Are you still there?" — these are ambiguous (could be a human checking the line) → maybe_human (ask for confirmation).
5. Is the system asking a direct question WITHOUT any personal introduction (and not during confirmation mode)? (e.g. "What can I help you with?", "Are you calling about X or Y?", "In a few words tell me how I can help") → speak (respond with your call purpose). Do NOT ask confirmation on every conversational bot utterance — just answer with your purpose.
6. Is this a voicemail/closed/dead end? → hang_up
7. Does speech sound human but ambiguous (no clear intro, could be post-hold fresh speech)? → maybe_human (system will confirm).
8. Is this a greeting/disclaimer/hold music? → wait
9. If menu detected: pick the best option for the call purpose.
   - If the call purpose is "speak with a representative" and NO option matches a rep path (representative/agent/operator/admin/other inquiries/general inquiries/front desk/customer service/tech support/billing) → WAIT. Do NOT press a specific-category digit just to press something. "Insurance company", "attorney's office", "financial estimate", "prior authorization" are NOT rep paths.
   - If the call purpose is a specific task and no option matches → press the numerically smallest digit (1 is smaller than 2).
   - If the system says "sorry we didn't get that" with the same menu, press NOW — you already missed it once.
10. If data entry is requested (ZIP, phone, account): determine if DTMF or speech is expected, then speak the data. EXCEPTION: If the prompt frames data entry as a single menu option ("Using your loan number, press 1", "Press 1 to enter your account number") and you DO NOT have that data → WAIT. The full menu will continue and usually include a rep option (e.g. step 2 "Press 2 to speak with a representative"). Never press the data-entry digit without the data.
11. NEVER return "wait" more than 2 turns in a row for the same menu. If previous actions show repeated waits on menu options, press the best available digit.
12. CRITICAL: If you see FAILED DIGITS above, those digits DO NOT WORK. You MUST choose a digit NOT in the failed list. If the warning says ALL DTMF digits have been rejected, you MUST use action "speak" (NOT "press_digit") and say the option name or digit aloud (e.g., "one" or "administrative staff" or "representative").`;

    return { systemMessage: systemPrompt.system, userMessage };
  }

  async decideAction(params: DecideActionParams): Promise<CallAction> {
    const {
      config,
      currentSpeech,
      awaitingHumanConfirmation,
      awaitingHumanClarification,
    } = params;
    const { systemMessage, userMessage } = this.buildMessages(params);

    const provider = this.getProvider();
    const apiStart = Date.now();
    let content: string;

    if (provider === 'anthropic') {
      const response = await this.anthropicClient.messages.create({
        model: process.env.ANTHROPIC_MODEL_OVERRIDE || CLAUDE_HAIKU_MODEL,
        system: [
          {
            type: 'text',
            text: systemMessage,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 800,
        temperature: 0,
      });
      console.log(
        `⏱️ API call: ${Date.now() - apiStart}ms | in=${response.usage?.input_tokens} out=${response.usage?.output_tokens} cache_read=${response.usage?.cache_read_input_tokens ?? 0} cache_write=${response.usage?.cache_creation_input_tokens ?? 0}`
      );
      const first = response.content[0];
      content = first && first.type === 'text' ? first.text : '';
    } else if (provider === 'gemini') {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey)
        throw new Error('GOOGLE_API_KEY not set for gemini provider');
      const model = process.env.GEMINI_MODEL_OVERRIDE || GEMINI_DEFAULT_MODEL;
      const result = await callGeminiNonStreaming({
        apiKey,
        model,
        systemMessage,
        userMessage,
      });
      console.log(
        `⏱️ API call: ${Date.now() - apiStart}ms | in=${result.usage.promptTokenCount} out=${result.usage.candidatesTokenCount}`
      );
      content = result.content;
    } else {
      const response = await this.openaiClient.chat.completions.create({
        model:
          process.env.OPENAI_MODEL_OVERRIDE ||
          config.aiSettings?.model ||
          'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 400,
        temperature: 0,
      });
      console.log(
        `⏱️ API call: ${Date.now() - apiStart}ms | in=${response.usage?.prompt_tokens} out=${response.usage?.completion_tokens}`
      );
      content = response.choices[0]?.message?.content || '';
    }

    if (!content) {
      throw new Error('No response from IVR navigator AI');
    }

    return this.postProcessAction(content, {
      currentSpeech,
      awaitingHumanConfirmation,
      awaitingHumanClarification,
    });
  }

  /**
   * Parse the JSON string returned by the AI, normalize it, and apply the
   * downgrade/fallback guards. Shared between decideAction and
   * decideActionStreaming so both paths run identical post-processing.
   */
  private postProcessAction(
    content: string,
    ctx: {
      currentSpeech: string;
      awaitingHumanConfirmation?: boolean;
      awaitingHumanClarification?: boolean;
    }
  ): CallAction {
    const {
      currentSpeech,
      awaitingHumanConfirmation,
      awaitingHumanClarification,
    } = ctx;

    // Extract the first complete top-level JSON object. Greedy /\{[\s\S]*\}/
    // breaks when Claude appends prose containing braces after the JSON
    // (observed live: "Unexpected non-whitespace character after JSON at
    // position 1002"). Brace-count with string-awareness instead.
    const extracted = extractFirstJsonObject(content);
    if (!extracted) {
      throw new Error(`Could not parse JSON from AI response: ${content}`);
    }
    const action = JSON.parse(extracted) as CallAction;

    // Normalize menu options to lowercase
    if (action.detected?.menuOptions) {
      action.detected.menuOptions = action.detected.menuOptions.map(opt => ({
        digit: opt.digit,
        option: opt.option.toLowerCase().trim(),
      }));
    }

    if (action.action === 'human_detected' && awaitingHumanConfirmation) {
      const stripped = currentSpeech.toLowerCase().replace(/[^a-z]/g, '');
      const isPureFiller =
        /^(m+h*m*|h+m+|u+h*m*|uh+|um+|hm+|mmhm+|mhm+|mmm+)$/.test(stripped);
      if (isPureFiller && stripped.length <= 6) {
        console.log(
          `[NAV] Downgrading human_detected → maybe_human_unclear: pure filler sound "${stripped}"`
        );
        return {
          ...action,
          action: 'maybe_human_unclear',
          reason: `pure non-word filler "${stripped}" during confirmation — ambiguous, asking more directly`,
        };
      }
    }

    // Structural signal: short line-check greetings ("Hello, are you there?") are
    // ambiguous — could be a human checking the line after hold. Ask for confirmation
    // instead of answering with call purpose.
    if (
      action.action === 'speak' &&
      !awaitingHumanConfirmation &&
      !awaitingHumanClarification &&
      currentSpeech.length <= 40
    ) {
      const lineCheckRe =
        /^\s*(hello|hi|hey|anyone)\b[^a-z]*(are you (still )?(there|here)|are you there|still (there|here)|you (still )?(there|here))\??\s*$/i;
      if (lineCheckRe.test(currentSpeech.trim())) {
        console.log(
          `[NAV] Downgrading speak → maybe_human: short line-check greeting "${currentSpeech}"`
        );
        return {
          ...action,
          action: 'maybe_human',
          reason: `short line-check greeting ("${currentSpeech}") is ambiguous — asking for confirmation`,
        };
      }
    }

    if (
      action.action === 'press_digit' &&
      action.digit &&
      !transcriptContainsDigit(currentSpeech, action.digit)
    ) {
      const validDigits = (action.detected.menuOptions || [])
        .filter(o => typeof o.digit === 'string' && /^\d$|^[*#]$/.test(o.digit))
        .filter(o => transcriptContainsDigit(currentSpeech, o.digit))
        .sort((a, b) => (a.digit < b.digit ? -1 : 1));

      const REP_PATH_RE =
        /\b(representative|agent|operator|administrative|admin|front desk|other inquiries|other departments|general inquir|tech(nical)? support|billing|customer service)\b/i;
      const hasRepPath = validDigits.some(o => REP_PATH_RE.test(o.option));

      if (validDigits.length > 0 && hasRepPath) {
        const lowest = validDigits[0].digit;
        console.log(
          `[NAV] Rejected hallucinated press_digit ${action.digit}, falling back to lowest ${lowest} (has rep path)`
        );
        return {
          ...action,
          action: 'press_digit',
          digit: lowest,
          reason: `replaced hallucinated ${action.digit} with ${lowest} from AI's own menuOptions`,
        };
      }

      console.log(
        `[NAV] Rejecting hallucinated press_digit ${action.digit} — no rep path in options, wait`
      );
      return {
        ...action,
        action: 'wait',
        digit: undefined,
        reason: `rejected hallucinated press_digit ${action.digit}: no valid rep-path option in transcript`,
      };
    }

    return action;
  }

  /**
   * Streaming variant of decideAction. Uses identical prompts to decideAction
   * but streams the JSON completion — as the AI emits the "speech" field
   * character-by-character, we fire them through the SpeechFieldExtractor so
   * the caller can start dispatching TTS before the full response arrives.
   *
   * The final action is still parsed from the full JSON once the stream ends,
   * so all downstream routing/guards behave identically.
   */
  async decideActionStreaming(
    params: DecideActionParams & {
      callbacks: StreamingCallbacks;
      callSid?: string;
    }
  ): Promise<StreamingResult> {
    const {
      config,
      currentSpeech,
      awaitingHumanConfirmation,
      awaitingHumanClarification,
      callbacks,
      callSid,
    } = params;
    const { systemMessage, userMessage } = this.buildMessages(params);

    const provider = this.getProvider();
    const apiStart = Date.now();

    const extractor = new SpeechFieldExtractor();
    const digitExtractor = new PressDigitExtractor();
    let speculativeDigitFiredAt: number | null = null;
    let firstTokenAt: number | null = null;
    let speechDoneFiredAt: number | null = null;
    let fullContent = '';

    const onDelta = (delta: string) => {
      if (!delta) return;
      if (firstTokenAt === null) {
        firstTokenAt = Date.now();
        console.log(
          `⏱️ Time to first token (streaming): ${firstTokenAt - apiStart}ms`
        );
        if (callSid) {
          callStateManager.updateCallState(callSid, {
            firstTokenAt,
          });
        }
      }
      fullContent += delta;
      const extracted = extractor.extract(delta);
      if (extracted) callbacks.onSpeechChunk(extracted);
      if (callbacks.onSpeculativeDigit && speculativeDigitFiredAt === null) {
        const speculativeDigit = digitExtractor.extract(delta);
        if (speculativeDigit) {
          speculativeDigitFiredAt = Date.now();
          console.log(
            `⚡ Speculative DTMF parsed mid-stream: digit=${speculativeDigit} (${speculativeDigitFiredAt - apiStart}ms after stream start)`
          );
          callbacks.onSpeculativeDigit(speculativeDigit);
        }
      }
      if (extractor.isDone() && speechDoneFiredAt === null) {
        speechDoneFiredAt = Date.now();
        console.log(
          `⏱️ Speech field complete (streaming): ${speechDoneFiredAt - apiStart}ms`
        );
        if (callSid) {
          callStateManager.updateCallState(callSid, {
            speechFieldCompleteAt: speechDoneFiredAt,
          });
        }
        callbacks.onSpeechDone();
      }
    };

    if (provider === 'anthropic') {
      const stream = this.anthropicClient.messages.stream({
        model: process.env.ANTHROPIC_MODEL_OVERRIDE || CLAUDE_HAIKU_MODEL,
        system: [
          {
            type: 'text',
            text: systemMessage,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 800,
        temperature: 0,
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          onDelta(event.delta.text);
        }
      }

      const finalMessage = await stream.finalMessage();
      const streamCompleteAt = Date.now();
      console.log(
        `⏱️ Stream complete: ${streamCompleteAt - apiStart}ms | in=${finalMessage.usage?.input_tokens} out=${finalMessage.usage?.output_tokens}`
      );
      if (callSid) {
        callStateManager.updateCallState(callSid, { streamCompleteAt });
      }
    } else if (provider === 'gemini') {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey)
        throw new Error('GOOGLE_API_KEY not set for gemini provider');
      const model = process.env.GEMINI_MODEL_OVERRIDE || GEMINI_DEFAULT_MODEL;
      let lastUsage: GeminiUsage = {};
      for await (const event of streamGemini({
        apiKey,
        model,
        systemMessage,
        userMessage,
      })) {
        if (event.delta) onDelta(event.delta);
        if (event.usage) lastUsage = event.usage;
      }
      const streamCompleteAt = Date.now();
      console.log(
        `⏱️ Stream complete: ${streamCompleteAt - apiStart}ms | in=${lastUsage.promptTokenCount} out=${lastUsage.candidatesTokenCount}`
      );
      if (callSid) {
        callStateManager.updateCallState(callSid, { streamCompleteAt });
      }
    } else {
      const model =
        process.env.OPENAI_MODEL_OVERRIDE ||
        config.aiSettings?.model ||
        'gpt-4o-mini';

      const stream = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 400,
        temperature: 0,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) onDelta(delta);
      }

      const streamCompleteAt = Date.now();
      console.log(`⏱️ Stream complete: ${streamCompleteAt - apiStart}ms`);
      if (callSid) {
        callStateManager.updateCallState(callSid, { streamCompleteAt });
      }
    }

    if (!fullContent) {
      throw new Error('No response from IVR navigator AI (streaming)');
    }

    const action = this.postProcessAction(fullContent, {
      currentSpeech,
      awaitingHumanConfirmation,
      awaitingHumanClarification,
    });

    // If the AI chose "speak" but the extractor never completed (extractor could
    // fail if the JSON doesn't contain a "speech" key in the expected form), fall
    // back to firing the parsed speech post-stream so TTS still happens.
    if (
      action.action === 'speak' &&
      action.speech &&
      speechDoneFiredAt === null
    ) {
      console.log(
        '[NAV] Streaming speech extraction missed — firing full text post-stream as fallback'
      );
      if (callSid) {
        callStateManager.updateCallState(callSid, {
          streamFallbackFired: true,
        });
      }
      callbacks.onSpeechChunk(action.speech);
      callbacks.onSpeechDone();
      return { action, speechStreamed: true };
    }

    return {
      action,
      speechStreamed: action.action === 'speak' && speechDoneFiredAt !== null,
    };
  }
}

const ivrNavigatorService = new IVRNavigatorService();

export default ivrNavigatorService;
