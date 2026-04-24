/**
 * Speech Processing Service
 * Main function used by BOTH route handler and eval service.
 * Orchestrates full speech processing: state management, AI decisions, and Telnyx API calls.
 *
 * ⚠️ LATENCY-SENSITIVE FILE — Before changing the dispatch pipeline or
 * streaming integration, read ../../LATENCY-OPTIMIZATIONS.md in the repo root.
 */

import callStateManager from './callStateManager';
import callHistoryService from './callHistoryService';
import { spaceOutNumbers } from '../utils/spaceOutNumbers';
import { sanitizeSpeakText } from '../utils/sanitizeSpeakText';
export { spaceOutNumbers };
import { EndReason } from '../models/CallHistory';
import ivrNavigatorService, {
  CallAction,
  StreamingCallbacks,
} from './ivrNavigatorService';
import telnyxService from './telnyxService';
import transferConfig from '../config/transfer-config';
import { MenuOption } from '../types/menu';
import { DTMFDecision, VoiceProcessingResult } from '../types/voiceProcessing';

// Streaming TTS is now the default. Set USE_STREAMING=false to disable (rollback escape hatch).
const USE_STREAMING = process.env.USE_STREAMING !== 'false';

// Common title abbreviations — if a period follows one of these (case-insensitive), don't split.
const ABBREVIATIONS =
  /\b(Dr|Mr|Mrs|Ms|St|Ave|Blvd|Rd|Vs|Etc|Jr|Sr|Prof|Gov|Sgt|Cpl|Lt|Capt|Col|Gen|Pres|Rep|Sen)\s*$/i;

export function isSentenceBoundary(
  text: string,
  boundaryIndex: number
): boolean {
  // boundaryIndex points to the punctuation char (.!?)
  const before = text.slice(0, boundaryIndex + 1);

  // Don't split on abbreviations like "Dr." — period after a short honorific.
  if (text[boundaryIndex] === '.') {
    if (ABBREVIATIONS.test(before)) return false;
    // Also skip if preceded by a single uppercase letter (e.g. "U.S.", initials)
    if (/\b[A-Z]\.$/.test(before)) return false;
  }

  return true;
}

export function extractSentences(buffer: string): {
  sentences: string[];
  remainder: string;
} {
  const sentences: string[] = [];
  let searchFrom = 0;

  while (searchFrom < buffer.length) {
    // Find next sentence-ending punctuation
    const match = /[.!?]/.exec(buffer.slice(searchFrom));
    if (!match) break;

    const absIdx = searchFrom + match.index;
    const afterPunct = buffer[absIdx + 1];

    // Valid boundary: punctuation followed by whitespace, end of buffer, or another punctuation
    const isFollowedByBreak =
      afterPunct === undefined ||
      afterPunct === ' ' ||
      afterPunct === '\n' ||
      /[.!?]/.test(afterPunct);

    if (isFollowedByBreak && isSentenceBoundary(buffer, absIdx)) {
      const sentence = buffer.slice(0, absIdx + 1).trim();
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
      // Remainder starts after the punctuation + any trailing whitespace
      const afterSentence = buffer.slice(absIdx + 1).replace(/^\s+/, '');
      buffer = afterSentence;
      searchFrom = 0;
    } else {
      searchFrom = absIdx + 1;
    }
  }

  return { sentences, remainder: buffer };
}

/**
 * Build a StreamingCallbacks adapter that buffers incoming token deltas,
 * extracts complete sentences, and dispatches each one to telnyxService as
 * an independent speakText call. Sentences are chained so they play in order.
 *
 * The caller must await `flush()` once the AI stream ends — that drains any
 * remaining buffered text and waits for the full speak chain to resolve before
 * clearing streamingTTSActive + isSpeaking.
 */
function createSentenceBufferedTTS({
  callSid,
  voice,
}: {
  callSid: string;
  voice: string;
}): StreamingCallbacks & {
  getFullText: () => string;
  flush: () => Promise<void>;
} {
  let fullText = '';
  let buffer = '';
  let speakChain: Promise<void> = Promise.resolve();
  let firstChunkAt: number | null = null;
  let firstSpeakDispatchedAt: number | null = null;
  let sentenceCount = 0;
  let isSpeakingSet = false;

  function dispatchSentence(sentence: string): void {
    if (!isSpeakingSet) {
      const dispatchedAt = Date.now();
      const prev = callStateManager.getCallState(callSid);
      callStateManager.updateCallState(callSid, {
        isSpeaking: true,
        streamingTTSActive: true,
        lastSpeakStartedAt: dispatchedAt,
        bargeInFiredThisTurn: false,
        ttsDispatchedAt: prev.ttsDispatchedAt ?? dispatchedAt,
      });
      isSpeakingSet = true;
    }
    sentenceCount++;
    const n = sentenceCount;
    const preview = sentence.slice(0, 60) + (sentence.length > 60 ? '...' : '');
    if (firstSpeakDispatchedAt === null) {
      const elapsed = firstChunkAt !== null ? Date.now() - firstChunkAt : 0;
      console.log(`⏱️ First sentence dispatched to TTS: ${elapsed}ms`);
      firstSpeakDispatchedAt = Date.now();
      callStateManager.updateCallState(callSid, {
        firstSentenceDispatchedAt: firstSpeakDispatchedAt,
      });
    }
    // Sanitize "press [digit]" phrasing BEFORE spacing out numbers — on
    // voicebots this phrasing dead-ends the call, so rewrite to
    // "representative". Then space out multi-digit numbers so TTS speaks them
    // one digit at a time. Both paths must run.
    const sanitized = sanitizeSpeakText(sentence);
    if (sanitized !== sentence) {
      console.log(`🧹 sanitizeSpeakText: "${sentence}" → "${sanitized}"`);
    }
    const spoken = spaceOutNumbers(sanitized);
    console.log(`⏱️ Sentence ${n} dispatched: "${preview}"`);
    speakChain = speakChain
      .then(() => telnyxService.speakText(callSid, spoken, voice))
      .catch(err => console.error('Streaming TTS error:', err));
  }

  return {
    onSpeechChunk(text: string) {
      if (firstChunkAt === null) firstChunkAt = Date.now();
      fullText += text;
      buffer += text;

      const { sentences, remainder } = extractSentences(buffer);
      buffer = remainder;

      for (const sentence of sentences) {
        dispatchSentence(sentence);
      }
    },

    onSpeechDone() {
      // Flush any remaining text in the buffer (last partial sentence or a
      // response with no terminal punctuation).
      const remaining = buffer.trim();
      if (remaining.length > 0) {
        buffer = '';
        dispatchSentence(remaining);
      }
    },

    getFullText() {
      return fullText;
    },

    flush(): Promise<void> {
      return speakChain.then(() => {
        callStateManager.updateCallState(callSid, {
          streamingTTSActive: false,
          isSpeaking: false,
        });
      });
    },
  };
}

/**
 * Map the AI's terminationReason to a structured endReason enum value.
 * Unknown / missing reasons fall through to 'ai_hangup_dead_end'.
 */
function mapTerminationReasonToEndReason(
  terminationReason: string | undefined
): EndReason {
  switch (terminationReason) {
    case 'voicemail':
      return 'ai_hangup_voicemail';
    case 'closed_no_menu':
      return 'ai_hangup_closed';
    case 'dead_end':
      return 'ai_hangup_dead_end';
    default:
      return 'ai_hangup_dead_end';
  }
}

export interface ProcessSpeechParams {
  callSid: string;
  speechResult: string;
  isFirstCall: boolean;
  baseUrl: string;
  transferNumber?: string;
  callPurpose?: string;
  customInstructions?: string;
  userPhone?: string;
  userEmail?: string;
  testMode?: boolean;
  skipInfoRequests?: boolean;
  requireLiveAgent?: boolean;
  _sttDoneAt?: number;
}

export interface ProcessSpeechResult {
  twiml: string;
  shouldSend: boolean;
  processingResult?: VoiceProcessingResult;
  aiAction?: string;
  aiResponse?: string;
  digitPressed?: string;
}

/**
 * Extract pure digits from text (e.g., "90001", "720-584-6358" → "7205846358").
 */
function extractDTMFDigits(text: string): string | null {
  const stripped = text.replace(/[\s\-().+]/g, '');
  if (stripped.length >= 3 && /^\d+$/.test(stripped)) {
    return stripped;
  }
  return null;
}

function formatDigitsForSpeech(digits: string): string {
  return digits.split('').join(' ');
}

// spaceOutNumbers moved to ../utils/spaceOutNumbers for test isolation

/**
 * Map a CallAction from the unified AI into the backward-compatible VoiceProcessingResult
 */
function mapActionToProcessingResult(
  action: CallAction,
  callPurpose: string
): VoiceProcessingResult {
  const dtmfDecision: DTMFDecision = {
    callPurpose,
    shouldPress: action.action === 'press_digit' && !!action.digit,
    digit: action.action === 'press_digit' ? action.digit || null : null,
    matchedOption: action.reason,
    matchType: action.detected.isIVRMenu ? 'semantic' : 'fallback',
    reason: action.reason,
  };

  return {
    isIVRMenu: action.detected.isIVRMenu,
    menuOptions: action.detected.menuOptions as MenuOption[],
    isMenuComplete: action.detected.isMenuComplete,
    loopDetected: action.detected.loopDetected,
    shouldTerminate: action.action === 'hang_up',
    terminationReason: action.detected.terminationReason,
    transferRequested: action.detected.transferRequested,
    transferConfidence: action.detected.transferConfidence,
    transferReason: action.reason,
    dtmfDecision,
    shouldPreventDTMF:
      action.detected.loopDetected && action.action !== 'press_digit',
  };
}

function getTelnyxVoice(aiVoice?: string): string {
  if (aiVoice?.startsWith('Polly.')) {
    return `AWS.${aiVoice}-Neural`;
  }
  return aiVoice || 'Telnyx.KokoroTTS.am_michael';
}

async function speakAndLog(
  callSid: string,
  text: string,
  voice: string
): Promise<void> {
  // The call-ended short-circuit lives in telnyxService.guardedAction now —
  // single source of truth. speakText will no-op if the call is tombstoned.
  callHistoryService
    .addConversation(callSid, 'ai', text)
    .catch(err => console.error('Error adding conversation:', err));
  const dispatchedAt = Date.now();
  const prev = callStateManager.getCallState(callSid);
  callStateManager.updateCallState(callSid, {
    isSpeaking: true,
    lastSpeakStartedAt: dispatchedAt,
    bargeInFiredThisTurn: false,
    // Only capture the first dispatch of the turn (later sentences in the same
    // turn shouldn't overwrite the anchor).
    ttsDispatchedAt: prev.ttsDispatchedAt ?? dispatchedAt,
  });
  // Reset silent-hold timer — AI speech counts as activity, not silence
  const { resetSilentHoldTimer } = await import('../routes/streamRoutes');
  resetSilentHoldTimer(callSid);
  await telnyxService.speakText(callSid, text, voice);
  callStateManager.updateCallState(callSid, { isSpeaking: false });
  resetSilentHoldTimer(callSid);
}

/**
 * Process a speech turn end-to-end.
 * Used by both the transcription webhook handler and eval service (testMode).
 */
export async function processSpeech({
  callSid,
  speechResult,
  isFirstCall: _isFirstCall,
  baseUrl: _baseUrl,
  transferNumber,
  callPurpose,
  customInstructions,
  userPhone,
  userEmail,
  testMode = false,
  skipInfoRequests,
  requireLiveAgent,
  _sttDoneAt,
}: ProcessSpeechParams): Promise<ProcessSpeechResult> {
  try {
    const enterAt = Date.now();
    if (_sttDoneAt) {
      console.log(`⏱️ STT→processSpeech: ${enterAt - _sttDoneAt}ms`);
    }
    if (!callSid) throw new Error('Call SID is missing');

    // ── 1. State & config setup ──────────────────────────────────────────────
    const callState = callStateManager.getCallState(callSid);

    // If we've already initiated a transfer, ignore further speech — the call is handed off.
    if (callState.transferInitiated && !testMode) {
      console.log(
        `🔇 Ignoring speech after transfer initiated: "${speechResult.slice(0, 60)}"`
      );
      return { twiml: '', shouldSend: false };
    }
    const existing = callState.transferConfig;
    const finalCustomInstructions =
      customInstructions ||
      existing?.customInstructions ||
      callState.customInstructions ||
      '';

    const config = transferConfig.createConfig({
      transferNumber:
        transferNumber ||
        existing?.transferNumber ||
        process.env.TRANSFER_PHONE_NUMBER,
      userPhone:
        userPhone || existing?.userPhone || process.env.USER_PHONE_NUMBER,
      userEmail: userEmail || existing?.userEmail || process.env.USER_EMAIL,
      callPurpose:
        callPurpose ||
        existing?.callPurpose ||
        process.env.CALL_PURPOSE ||
        'speak with a representative',
      customInstructions: finalCustomInstructions,
    });

    if (finalCustomInstructions || config.userPhone) {
      callStateManager.updateCallState(callSid, {
        ...(finalCustomInstructions && {
          customInstructions: finalCustomInstructions,
        }),
        ...(config.userPhone && { userPhone: config.userPhone }),
      });
    }

    if (!testMode) {
      console.log('👤', speechResult);
    }

    if (!testMode) {
      callHistoryService
        .addConversation(callSid, 'user', speechResult)
        .catch(err => console.error('Error adding conversation:', err));
    }

    const actionHistory = callState.actionHistory || [];

    // ── 2. AI call (streaming or non-streaming) ─────────────────────────────
    const conversationHistory = callState.conversationHistory || [];

    const aiParams = {
      config,
      conversationHistory: conversationHistory.map(h => ({
        type: h.type,
        text: h.text || '',
      })),
      actionHistory,
      currentSpeech: speechResult,
      previousMenus: callState.previousMenus || [],
      lastPressedDTMF: callState.lastPressedDTMF,
      callPurpose: config.callPurpose,
      awaitingHumanConfirmation: callState.awaitingHumanConfirmation,
      awaitingHumanClarification: callState.awaitingHumanClarification,
      skipInfoRequests: skipInfoRequests ?? callState.skipInfoRequests,
      requireLiveAgent: requireLiveAgent ?? callState.requireLiveAgent,
    };

    const aiStartAt = Date.now();
    let action: CallAction;
    let speechAlreadyStreamed = false;

    if (USE_STREAMING && !testMode) {
      const ttsCallbacks = createSentenceBufferedTTS({
        callSid,
        voice: getTelnyxVoice(config.aiSettings.voice),
      });
      const streamResult = await ivrNavigatorService.decideActionStreaming({
        ...aiParams,
        callbacks: ttsCallbacks,
        callSid,
      });
      // Fire-and-forget flush: drain the speak chain in the background so
      // streamingTTSActive/isSpeaking clear correctly, but DON'T block the
      // main flow on it. Telnyx has already queued the TTS server-side by the
      // time the speakText API call resolves; the user hears audio independent
      // of when processSpeech returns. Blocking here was adding ~speakText API
      // latency per turn on the critical path for zero user-perceived benefit.
      ttsCallbacks
        .flush()
        .catch(err => console.error('Streaming TTS flush error:', err));
      action = streamResult.action;
      speechAlreadyStreamed = streamResult.speechStreamed;
      if (speechAlreadyStreamed) {
        const streamedText = ttsCallbacks.getFullText();
        // Stamp the ai-conversation event at the moment the FIRST sentence was
        // dispatched to Telnyx — that's the closest proxy we have for when the
        // user actually hears audio start. Without this, the timestamp ends up
        // ~1-2s late (post-stream-complete wall clock) and clicking it in the
        // UI seeks the recording past the start of the AI response.
        // Prefer ttsSpeakStartedAt (captured on call.speak.started webhook —
        // the actual moment Telnyx begins playing audio in the recording).
        // Fall back to firstSentenceDispatchedAt + ~900ms (measured median
        // Telnyx pipeline delay) when the speak.started webhook hasn't
        // arrived yet. Both beat the prior default (end-of-stream wall
        // clock, ~1-2s LATE) AND the interim firstSentenceDispatchedAt fix
        // (which was ~900ms EARLY, the other direction).
        const cs = callStateManager.getCallState(callSid);
        const TELNYX_PIPELINE_OFFSET_MS = 900;
        let aiTimestamp: Date | null = null;
        if (cs.lastSpeakStartedAt) {
          aiTimestamp = new Date(cs.lastSpeakStartedAt);
        } else if (cs.firstSentenceDispatchedAt) {
          aiTimestamp = new Date(
            cs.firstSentenceDispatchedAt + TELNYX_PIPELINE_OFFSET_MS
          );
        }
        callHistoryService
          .addConversation(callSid, 'ai', streamedText, aiTimestamp)
          .catch(err => console.error('Error adding conversation:', err));
      }
    } else {
      action = await ivrNavigatorService.decideAction(aiParams);
    }

    const aiDoneAt = Date.now();
    // Full AI decision log — so we can diagnose why the AI chose a given action without
    // needing to add phrase-matching overrides later.
    console.log(
      `🤖 AI DECISION (${aiDoneAt - aiStartAt}ms):\n` +
        `   IVR heard: "${speechResult.slice(0, 150)}"\n` +
        `   Action: ${action.action}${action.digit ? ` digit=${action.digit}` : ''}${action.speech ? ` speech="${action.speech}"` : ''}\n` +
        `   Reason: ${action.reason}\n` +
        `   Detected: isIVRMenu=${action.detected.isIVRMenu} hold=${action.detected.holdDetected} loop=${action.detected.loopDetected} transferReq=${action.detected.transferRequested} humanIntro=${action.detected.humanIntroDetected}\n` +
        `   State: awaitConf=${!!callState.awaitingHumanConfirmation} awaitClar=${!!callState.awaitingHumanClarification} transferred=${!!callState.transferInitiated}`
    );

    // ── Backend enforcement ─────────────────────────────────────────────────
    // No regex/phrase-matching on speech. Only enforce consistency with flags the
    // AI ITSELF set in the response — the AI made the judgment, we just ensure its
    // declared action matches its declared observations.

    const confirmationPending =
      !!callState.awaitingHumanConfirmation ||
      !!callState.awaitingHumanClarification;

    // Structural gate: human_detected is only valid when a confirmation question
    // is already pending. Otherwise downgrade to maybe_human so the system asks
    // "Am I speaking with a live agent?" first. No exceptions.
    if (action.action === 'human_detected' && !confirmationPending) {
      console.log(
        `⚠️ human_detected without pending confirmation → maybe_human (was human_detected on speech: "${speechResult.slice(0, 80)}")`
      );
      action.action = 'maybe_human';
    }

    // Consistency check: if the AI set humanIntroDetected=true (a proper personal
    // introduction), route through the MANDATORY confirmation flow.
    // - No confirmation pending → maybe_human (system will ask "Am I speaking with
    //   a live agent?"). Never fast-path to human_detected on a name alone.
    // - Confirmation already pending → human_detected is fine.
    if (
      action.detected.humanIntroDetected &&
      !confirmationPending &&
      action.action !== 'maybe_human' &&
      action.action !== 'hang_up' &&
      action.action !== 'press_digit'
    ) {
      console.log(
        `⚠️ AI flag consistency: humanIntroDetected=true + no confirmation pending → maybe_human (was ${action.action})`
      );
      action.action = 'maybe_human';
    }

    // Consistency check: if the AI set isIVRMenu=true AND isMenuComplete=true and
    // declared menu options with digits, it should press one. When AI returns "speak"
    // instead, fall back to pressing the lowest digit FROM THE AI'S OWN DECLARED MENU
    // OPTIONS. Do NOT fire this for wait actions — a wait on an IVR menu means the AI
    // believes the menu is incomplete and we should listen for more options.
    if (
      action.detected.isIVRMenu &&
      action.detected.isMenuComplete &&
      action.action === 'speak' &&
      action.detected.menuOptions &&
      action.detected.menuOptions.length > 0
    ) {
      // Sort AI's own menuOptions by digit and pick the lowest valid one.
      const sortedDigits = [...action.detected.menuOptions]
        .map(o => o.digit)
        .filter(d => typeof d === 'string' && /^\d$|^[*#]$/.test(d))
        .sort();
      if (sortedDigits.length > 0) {
        console.log(
          `⚠️ AI flag consistency: isIVRMenu=true + isMenuComplete=true but action=speak → press_digit=${sortedDigits[0]} (using AI's own declared options)`
        );
        action.action = 'press_digit';
        action.digit = sortedDigits[0];
      } else {
        action.action = 'wait';
      }
    }

    const result = mapActionToProcessingResult(
      action,
      config.callPurpose || 'speak with a representative'
    );

    // ── 3. Record this turn in action history ────────────────────────────────
    callStateManager.addActionToHistory(callSid, {
      turnNumber: actionHistory.length + 1,
      ivrSpeech: speechResult,
      action: action.action,
      digit: action.digit,
      speech: action.speech,
      reason: action.reason,
    });

    // Reset silent-hold timer after any action (DTMF press, wait, speak, etc.)
    // The IVR may take time to process DTMF input — that's expected, not hold.
    if (!testMode) {
      const { resetSilentHoldTimer } = await import('../routes/streamRoutes');
      resetSilentHoldTimer(callSid);
    }

    // ── 3b. Store detected menu options for loop detection ───────────────────
    const detectedMenuOptions = action.detected.menuOptions as MenuOption[];
    if (detectedMenuOptions.length > 0) {
      callStateManager.updateCallState(callSid, {
        previousMenus: [
          ...(callState.previousMenus || []),
          detectedMenuOptions,
        ],
      });
    }

    // ── 4. Handle termination ────────────────────────────────────────────────
    if (action.action === 'hang_up') {
      if (!testMode) {
        console.log(
          `🛑 Call Terminated: ${action.detected.terminationReason || action.reason}`
        );
        callHistoryService
          .addTermination(
            callSid,
            action.detected.terminationReason || action.reason
          )
          .catch(err => console.error('Error adding termination:', err));
        const endReason = mapTerminationReasonToEndReason(
          action.detected.terminationReason
        );
        callHistoryService
          .endCall(
            callSid,
            'terminated',
            endReason,
            action.detected.terminationReason || action.reason
          )
          .catch(err => console.error('Error ending call:', err));

        await speakAndLog(
          callSid,
          'Thank you. Goodbye.',
          getTelnyxVoice(config.aiSettings.voice)
        );
        await telnyxService.terminateCall(callSid);
        const { stopSilentHoldTimer } = await import('../routes/streamRoutes');
        stopSilentHoldTimer(callSid);
        callStateManager.clearCallState(callSid);
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5. Handle human confirmed → dial user ─────────────────────────────────
    if (action.action === 'human_detected') {
      if (!testMode) {
        console.log(`🔄 Human confirmed, dialing user: ${action.reason}`);
        callHistoryService
          .addTransfer(callSid, config.transferNumber, false)
          .catch(err => console.error('Error adding transfer:', err));

        callStateManager.updateCallState(callSid, {
          awaitingHumanConfirmation: false,
          awaitingHumanClarification: false,
          humanConfirmationAttempts: 0,
          transferInitiated: true,
        });

        // Stop the silent-hold timer — we're handing off, no more hold events on this call
        const { stopSilentHoldTimer } = await import('../routes/streamRoutes');
        stopSilentHoldTimer(callSid);

        // Blind transfer via dial+bridge (not actions.transfer, which leaves
        // our leg in the bridge as a 3-way call). Dial the user as a NEW
        // outbound leg carrying bridgeSourceCallControlId in client_state;
        // the webhook bridges A↔C on call.answered, at which point our
        // backend drops out of the media path.
        const webhookUrl =
          process.env.TELNYX_WEBHOOK_URL || process.env.BASE_URL || undefined;
        await telnyxService.dialForBridge({
          sourceCallControlId: callSid,
          userPhone: config.transferNumber,
          webhookUrl,
        });
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5b. Handle maybe_human → ask confirmation ────────────────────────────
    if (action.action === 'maybe_human') {
      if (!testMode) {
        console.log(
          `❓ Maybe human detected, asking confirmation: ${action.reason}`
        );
      }

      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: true,
      });

      if (!testMode) {
        await speakAndLog(
          callSid,
          'Hi, am I speaking with a live agent?',
          getTelnyxVoice(config.aiSettings.voice)
        );
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5c. Handle maybe_human_unclear → ask clarification ──────────────────
    if (action.action === 'maybe_human_unclear') {
      if (!testMode) {
        console.log(
          `❓ Unclear response to confirmation, asking clarification: ${action.reason}`
        );
      }

      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: false,
        awaitingHumanClarification: true,
      });

      if (!testMode) {
        await speakAndLog(
          callSid,
          "I'm sorry, are you a human or an automated message?",
          getTelnyxVoice(config.aiSettings.voice)
        );
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── Reset confirmation state on non-human actions ────────────────────────
    // Keep humanConfirmationAttempts — we track total attempts per call to prevent
    // bots (Walmart, UMR) from triggering infinite confirmation loops.
    if (
      callState.awaitingHumanConfirmation ||
      callState.awaitingHumanClarification
    ) {
      callStateManager.updateCallState(callSid, {
        awaitingHumanConfirmation: false,
        awaitingHumanClarification: false,
      });
    }

    // ── 5d. Handle request_info → stall + notify user ───────────────────────
    // Backend guard: if skipInfoRequests is on, override request_info → speak
    if (
      action.action === 'request_info' &&
      (skipInfoRequests ?? callState.skipInfoRequests)
    ) {
      action.action = 'speak';
      action.speech = "I don't have that information";
      action.reason = `request_info blocked by skipInfoRequests (wanted: ${action.requestedInfo})`;
      action.requestedInfo = undefined;
    }

    if (action.action === 'request_info' && action.requestedInfo) {
      const requestedInfo = action.requestedInfo;

      callStateManager.setPendingInfoRequest(
        callSid,
        requestedInfo,
        action.detected.dataEntryMode
      );

      if (!testMode) {
        console.log(`📋 Info requested: ${requestedInfo}`);

        callHistoryService
          .addInfoRequest(callSid, requestedInfo)
          .catch(err => console.error('Error logging info request:', err));

        // Fire-and-forget SMS to user
        const userPhoneNumber =
          config.userPhone || process.env.USER_PHONE_NUMBER;
        if (userPhoneNumber) {
          telnyxService
            .sendSMS(
              userPhoneNumber,
              `Your call needs: ${requestedInfo}. Reply with the info to continue the call.`
            )
            .then(() => console.log(`📱 SMS sent to ${userPhoneNumber}`))
            .catch(err =>
              console.error('SMS send failed (non-blocking):', err)
            );
        }

        await speakAndLog(
          callSid,
          'One moment, let me look that up.',
          getTelnyxVoice(config.aiSettings.voice)
        );

        // Dynamically import to avoid circular dependency
        const { startStallTimer } = await import('../routes/voiceRoutes');
        startStallTimer(callSid);
      }

      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 5e. Loop-override: when the AI reports loopDetected=true but decided
    //       NOT to press a digit (wait/speak), force a press using the first
    //       plausible menu option. Some IVRs (e.g. Costco) continuously replay
    //       the same menu with no silence, so the AI's "wait" is guaranteed to
    //       loop forever. The prompt tells the model to press on loop, but the
    //       model doesn't always obey. This is the safety net.
    if (
      action.detected.loopDetected &&
      (action.action === 'wait' || action.action === 'speak')
    ) {
      const menuOptions = (action.detected.menuOptions as MenuOption[]) || [];
      const prevDigit = callState.lastPressedDTMF;
      // Prefer a menu option we haven't already pressed (rotate on repeat).
      // Fall back to any option if the only one available is the prev digit.
      const unpressed = menuOptions.filter(
        o => o.digit && o.digit !== prevDigit
      );
      const forced = unpressed[0] || menuOptions[0];
      if (forced && forced.digit) {
        console.log(
          `🔁 Loop override: AI said ${action.action} on loopDetected=true — forcing press_digit=${forced.digit} (${forced.option})`
        );
        action.action = 'press_digit';
        action.digit = forced.digit;
        action.reason = `Loop override: ${action.reason || 'AI returned non-press on loop'} → force press ${forced.digit} (${forced.option})`;
      }
    }

    // ── 6. Handle IVR menu / press digit ─────────────────────────────────────
    if (action.action === 'press_digit' && action.digit) {
      const menuOptions = action.detected.menuOptions as MenuOption[];

      if (menuOptions.length > 0) {
        if (!testMode) {
          callHistoryService.addIVRMenu(callSid, menuOptions);
        }
        callStateManager.updateCallState(callSid, {
          lastMenuOptions: menuOptions,
          previousMenus: [...(callState.previousMenus || []), menuOptions],
          menuLevel: (callState.menuLevel || 0) + 1,
        });
      }

      if (!testMode) {
        console.log(`🔢 Pressed DTMF: ${action.digit} - ${action.reason}`);
      }

      callStateManager.updateCallState(callSid, {
        lastPressedDTMF: action.digit,
      });

      if (!testMode) {
        callHistoryService
          .addDTMF(callSid, action.digit, `AI selected: ${action.reason}`)
          .catch(err => console.error('Error adding DTMF:', err));

        await telnyxService.sendDTMF(callSid, action.digit);

        // Arm the post-DTMF loop watcher. If the IVR continues talking without
        // firing another speech_final (Costco scenario — continuous menu with
        // no silence), the watcher in streamRoutes will force-dispatch the
        // accumulated interim transcript so the AI gets a second turn and
        // loopDetected can flip true.
        callStateManager.updateCallState(callSid, {
          lastDTMFPressedAt: Date.now(),
          lastDTMFDigit: action.digit,
          accumulatedInterimText: '',
          forcedReprocessFiredAt: undefined,
        });
      }
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
        digitPressed: action.digit,
      };
    }

    // ── 7. Handle wait (incomplete menu, silence, etc.) ──────────────────────
    if (action.action === 'wait') {
      if (action.detected.holdDetected && !testMode) {
        console.log(`📞 Hold queue detected: ${action.reason}`);
        callHistoryService
          .addHoldDetected(callSid)
          .catch(err => console.error('Error adding hold event:', err));
      }

      if (action.detected.isIVRMenu && !action.detected.isMenuComplete) {
        const menuOptions = action.detected.menuOptions as MenuOption[];
        if (!testMode && menuOptions.length > 0) {
          const menuSummary = `[IVR Menu incomplete - found: ${menuOptions.map(o => `Press ${o.digit} for ${o.option}`).join(', ')}. Waiting for more options...]`;
          callHistoryService
            .addConversation(callSid, 'system', menuSummary)
            .catch(err => console.error('Error adding conversation:', err));
        }
      }

      // wait: transcription continues; nothing to do on our side
      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
      };
    }

    // ── 8. Handle speak (AI conversational response) ─────────────────────────
    const aiResponse = action.speech || '';

    // When streaming is active, sentence-level TTS has already fired from the
    // stream callbacks — don't double-speak. Record history and return.
    if (speechAlreadyStreamed) {
      if (!testMode) {
        console.log('🤖 (streamed)', aiResponse);
        if (_sttDoneAt) {
          console.log(
            `⏱️ TOTAL STT→TTS (streamed): ${Date.now() - _sttDoneAt}ms`
          );
        }
      }
      callStateManager.addToHistory(callSid, {
        type: 'user',
        text: speechResult,
      });
      callStateManager.addToHistory(callSid, { type: 'ai', text: aiResponse });

      // Still check for DTMF digits in speech (e.g. data entry). Note: with
      // streaming on, we will have already spoken the digits as words — the
      // sendDTMF call here is the actual DTMF tones for IVR data entry.
      const dtmfDigits = extractDTMFDigits(aiResponse.trim());
      if (dtmfDigits && !testMode) {
        console.log(`🔢 Data entry DTMF (streamed): ${dtmfDigits}`);
        await telnyxService.sendDTMF(callSid, `ww${dtmfDigits}`);
      }

      return {
        twiml: '',
        shouldSend: !testMode,
        processingResult: result,
        aiAction: action.action,
        aiResponse,
      };
    }

    if (!testMode) {
      if (
        aiResponse &&
        aiResponse.trim().toLowerCase() !== 'silent' &&
        aiResponse.trim().length > 0
      ) {
        console.log('🤖', aiResponse);
      } else {
        console.log('🤖 Silent (no response generated)');
      }
    }

    callStateManager.addToHistory(callSid, {
      type: 'user',
      text: speechResult,
    });

    if (
      aiResponse &&
      aiResponse.trim().toLowerCase() !== 'silent' &&
      aiResponse.trim().length > 0
    ) {
      const dtmfDigits = extractDTMFDigits(aiResponse.trim());

      if (dtmfDigits && !testMode) {
        const dataEntryMode = action.detected.dataEntryMode || 'dtmf';

        if (dataEntryMode === 'speech') {
          callStateManager.addToHistory(callSid, {
            type: 'ai',
            text: `[Spoken digits: ${dtmfDigits}]`,
          });
          callHistoryService
            .addConversation(callSid, 'ai', formatDigitsForSpeech(dtmfDigits))
            .catch(err => console.error('Error adding conversation:', err));

          callStateManager.updateCallState(callSid, { isSpeaking: true });
          await telnyxService.speakText(
            callSid,
            formatDigitsForSpeech(dtmfDigits),
            getTelnyxVoice(config.aiSettings.voice)
          );
          callStateManager.updateCallState(callSid, { isSpeaking: false });
        } else {
          console.log(
            `🔢 Data entry DTMF: ${dtmfDigits} (from AI response "${aiResponse.trim()}")`
          );
          callStateManager.addToHistory(callSid, {
            type: 'ai',
            text: `[DTMF data entry: ${dtmfDigits}]`,
          });
          callHistoryService
            .addDTMF(callSid, dtmfDigits, 'AI data entry response')
            .catch(err => console.error('Error adding DTMF:', err));

          await telnyxService.sendDTMF(callSid, `ww${dtmfDigits}`);
        }

        return {
          twiml: '',
          shouldSend: !testMode,
          processingResult: result,
          aiAction: action.action,
          digitPressed: dtmfDigits,
        };
      }

      // Sanitize "press [digit]" phrasing (voicebot-safe), then space out
      // multi-digit numbers so TTS speaks them one digit at a time (IVRs
      // with speech recognition need digit-by-digit cadence).
      const sanitizedResponse = sanitizeSpeakText(aiResponse);
      if (sanitizedResponse !== aiResponse) {
        console.log(
          `🧹 sanitizeSpeakText: "${aiResponse}" → "${sanitizedResponse}"`
        );
      }
      const spokenResponse = spaceOutNumbers(sanitizedResponse);
      callStateManager.addToHistory(callSid, {
        type: 'ai',
        text: spokenResponse,
      });
      if (!testMode) {
        const ttsStartAt = Date.now();
        console.log(`⏱️ TTS SEND at ${new Date().toISOString()}`);
        await speakAndLog(
          callSid,
          spokenResponse,
          getTelnyxVoice(config.aiSettings.voice)
        );
        console.log(
          `⏱️ TTS API returned: ${Date.now() - ttsStartAt}ms at ${new Date().toISOString()}`
        );
        if (_sttDoneAt) {
          console.log(`⏱️ TOTAL STT→TTS: ${Date.now() - _sttDoneAt}ms`);
        }
      }
    }

    return {
      twiml: '',
      shouldSend: !testMode,
      processingResult: result,
      aiAction: action.action,
      aiResponse,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!testMode) {
      console.error('❌ Error in processSpeech:', errorMessage);
      try {
        // Natural-sounding closer. The old canned "application error has
        // occurred — please try again later" was spoken to live human
        // agents on the line, which is confusing + tips them off that
        // they're talking to a bot. This reads like a real person bailing.
        await speakAndLog(
          callSid,
          "Sorry, I'm having some trouble on my end — I'll have to call back. Thanks!",
          'Telnyx.KokoroTTS.am_michael'
        );
        await telnyxService.terminateCall(callSid);
      } catch {
        // Best effort — call may already be ended
      }
    }
    return { twiml: '', shouldSend: !testMode };
  }
}
