/**
 * Voice Processing Service
 * Core AI detection layer - used by both route handler (via speechProcessingService)
 * and evaluation tests directly.
 */

import { MenuOption } from '../types/menu';
import aiDetectionService from './aiDetectionService';
import aiDTMFService, { DTMFDecision } from './aiDTMFService';
import { TransferConfig } from './aiService';

export interface VoiceProcessingResult {
  isIVRMenu: boolean;
  menuOptions: MenuOption[];
  isMenuComplete: boolean;
  loopDetected: boolean;
  loopConfidence?: number;
  loopReason?: string;
  shouldTerminate: boolean;
  terminationReason?: string;
  transferRequested: boolean;
  transferConfidence?: number;
  transferReason?: string;
  dtmfDecision: DTMFDecision;
  shouldPreventDTMF: boolean;
}

export interface VoiceProcessingContext {
  speech: string;
  previousSpeech?: string;
  silenceDurationMs?: number;
  previousMenus: MenuOption[][];
  partialMenuOptions?: MenuOption[];
  lastPressedDTMF?: string;
  lastMenuForDTMF?: MenuOption[];
  consecutiveDTMFPresses?: { digit: string; count: number }[];
  config: TransferConfig;
}

/**
 * Core AI detection and decision layer.
 * Returns structured results — no state management, no TwiML.
 */
export async function processVoiceInput(
  context: VoiceProcessingContext
): Promise<VoiceProcessingResult> {
  const {
    speech,
    previousSpeech = '',
    silenceDurationMs = 0,
    previousMenus,
    partialMenuOptions = [],
    lastPressedDTMF,
    consecutiveDTMFPresses = [],
    config,
  } = context;

  const [termination, transferDetection, menuDetection] = await Promise.all([
    aiDetectionService.detectTermination(
      speech,
      previousSpeech,
      silenceDurationMs / 1000
    ),
    aiDetectionService.detectTransferRequest(speech),
    aiDetectionService.detectIVRMenu(speech),
  ]);

  const isIVRMenu = menuDetection.isIVRMenu;

  let menuOptions: MenuOption[] = [];
  let isMenuComplete = false;
  let loopDetected = false;
  let loopConfidence: number | undefined;
  let loopReason: string | undefined;
  let dtmfDecision: DTMFDecision = {
    callPurpose: config.callPurpose || 'speak with a representative',
    shouldPress: false,
    digit: null,
    matchedOption: '',
    reason: '',
  };
  let shouldPreventDTMF = false;

  if (isIVRMenu) {
    // First extract menu options, then run loop detection in parallel with DTMF decision
    const extractionResult =
      await aiDetectionService.extractMenuOptions(speech);
    const extractedMenuOptions = extractionResult.menuOptions;
    isMenuComplete = extractionResult.isComplete;

    // Merge with any partial options accumulated from previous calls
    let mergedMenuOptions = extractedMenuOptions;
    if (partialMenuOptions.length > 0) {
      const combined = [...partialMenuOptions, ...extractedMenuOptions];
      const seen = new Set<string>();
      mergedMenuOptions = combined.filter(opt => {
        const key = `${opt.digit}-${opt.option}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    menuOptions = mergedMenuOptions;

    // Run loop detection and DTMF decision in parallel
    const [loopCheck, dtmfResult] = await Promise.all([
      previousMenus.length > 0
        ? aiDetectionService.detectLoop(mergedMenuOptions, previousMenus)
        : Promise.resolve({ isLoop: false, confidence: 0, reason: '' }),
      aiDTMFService.understandCallPurposeAndPressDTMF(
        speech,
        {
          callPurpose: config.callPurpose,
          customInstructions: config.customInstructions,
        },
        mergedMenuOptions
      ),
    ]);

    loopDetected = loopCheck.isLoop;
    loopConfidence = loopCheck.confidence;
    loopReason = loopCheck.reason;

    // Semantic loop prevention: if a loop is detected with high confidence
    // and we've already pressed a DTMF for a similar menu, don't press again
    if (loopDetected && loopCheck.confidence > 0.7 && lastPressedDTMF) {
      shouldPreventDTMF = true;
    }

    // Consecutive press prevention: same digit pressed 3+ times in a row
    if (
      !shouldPreventDTMF &&
      lastPressedDTMF &&
      consecutiveDTMFPresses.length > 0
    ) {
      const lastPress =
        consecutiveDTMFPresses[consecutiveDTMFPresses.length - 1];
      if (lastPress.digit === lastPressedDTMF && lastPress.count >= 3) {
        shouldPreventDTMF = true;
      }
    }

    // Use DTMF result if not prevented
    if (!shouldPreventDTMF) {
      dtmfDecision = dtmfResult;
    }
  }

  return {
    isIVRMenu,
    menuOptions,
    isMenuComplete,
    loopDetected,
    loopConfidence,
    loopReason,
    shouldTerminate: termination.shouldTerminate,
    terminationReason: termination.reason || termination.message,
    transferRequested: transferDetection.wantsTransfer,
    transferConfidence: transferDetection.confidence,
    transferReason: transferDetection.reason,
    dtmfDecision,
    shouldPreventDTMF,
  };
}
