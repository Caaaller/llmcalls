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

  const termination = await aiDetectionService.detectTermination(
    speech,
    previousSpeech,
    silenceDurationMs / 1000
  );

  // 2. Detect transfer requests
  const transferDetection =
    await aiDetectionService.detectTransferRequest(speech);

  // 3. Detect IVR menu
  const menuDetection = await aiDetectionService.detectIVRMenu(speech);
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
    const extractionResult = await aiDetectionService.extractMenuOptions(speech);
    menuOptions = extractionResult.menuOptions;
    isMenuComplete = extractionResult.isComplete;

    // Merge with any partial options accumulated from previous calls
    if (partialMenuOptions.length > 0) {
      const combined = [...partialMenuOptions, ...menuOptions];
      const seen = new Set<string>();
      menuOptions = combined.filter(opt => {
        const key = `${opt.digit}-${opt.option}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Loop detection
    if (previousMenus.length > 0) {
      const loopCheck = await aiDetectionService.detectLoop(
        menuOptions,
        previousMenus
      );
      loopDetected = loopCheck.isLoop;
      loopConfidence = loopCheck.confidence;
      loopReason = loopCheck.reason;

      // Semantic loop prevention: if a loop is detected with high confidence
      // and we've already pressed a DTMF for a similar menu, don't press again
      if (loopDetected && loopCheck.confidence > 0.7 && lastPressedDTMF) {
        shouldPreventDTMF = true;
      }
    }

    // Consecutive press prevention: same digit pressed 3+ times in a row
    if (!shouldPreventDTMF && lastPressedDTMF && consecutiveDTMFPresses.length > 0) {
      const lastPress = consecutiveDTMFPresses[consecutiveDTMFPresses.length - 1];
      if (lastPress.digit === lastPressedDTMF && lastPress.count >= 3) {
        shouldPreventDTMF = true;
      }
    }

    // DTMF decision (only if not prevented)
    if (!shouldPreventDTMF) {
      dtmfDecision = await aiDTMFService.understandCallPurposeAndPressDTMF(
        speech,
        {
          callPurpose: config.callPurpose,
          customInstructions: config.customInstructions,
        },
        menuOptions
      );
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
