/**
 * Voice Processing Service
 * Core logic for processing speech, detecting menus, loops, and making DTMF decisions.
 * This service is used by both the route handler and evaluation tests to avoid code duplication.
 */

import { MenuOption } from '../types/menu';
import aiDetectionService from './aiDetectionService';
import aiDTMFService, { DTMFDecision } from './aiDTMFService';
import { TransferConfig } from './aiService';

export interface VoiceProcessingResult {
  // Detection results
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

  // DTMF decision
  dtmfDecision: DTMFDecision;

  // Loop prevention
  shouldPreventDTMF: boolean; // True if same menu detected and DTMF already pressed
}

export interface VoiceProcessingContext {
  speech: string;
  previousMenus: MenuOption[][];
  lastPressedDTMF?: string;
  lastMenuForDTMF?: MenuOption[];
  consecutiveDTMFPresses?: { digit: string; count: number }[];
  config: TransferConfig;
}

/**
 * Process speech and return structured results for decision-making
 * This is the core logic used by both route handlers and evaluation tests
 */
export async function processVoiceInput(
  context: VoiceProcessingContext
): Promise<VoiceProcessingResult> {
  const {
    speech,
    previousMenus,
    lastPressedDTMF,
    lastMenuForDTMF,
    consecutiveDTMFPresses = [],
    config,
  } = context;

  // 1. Detect termination
  const termination = await aiDetectionService.detectTermination(
    speech,
    '',
    0
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
    // Extract menu options
    const extractionResult =
      await aiDetectionService.extractMenuOptions(speech);
    menuOptions = extractionResult.menuOptions;
    isMenuComplete = extractionResult.isComplete;

    // Check for loop detection
    if (previousMenus.length > 0) {
      const loopCheck = await aiDetectionService.detectLoop(
        menuOptions,
        previousMenus
      );
      loopDetected = loopCheck.isLoop;
      loopConfidence = loopCheck.confidence;
      loopReason = loopCheck.reason;

      // Improved loop prevention: Use semantic similarity from AI loop detection
      // If a loop is detected with high confidence, prevent pressing ANY digit if we've
      // already pressed for a similar menu, regardless of which digit we pressed
      if (loopDetected && loopCheck.confidence > 0.7) {
        // If we've already pressed a DTMF for a similar menu (detected by AI), prevent re-pressing
        // This prevents pressing different digits in the same looping menu
        if (lastPressedDTMF && lastMenuForDTMF) {
          // Check if current menu is semantically similar to the menu we pressed for
          // by checking if AI detected it as a loop with high confidence
          shouldPreventDTMF = true;
        }
      }

      // Additional check: Prevent if we've pressed the same digit 3+ times consecutively
      if (lastPressedDTMF && consecutiveDTMFPresses.length > 0) {
        const lastPress = consecutiveDTMFPresses[consecutiveDTMFPresses.length - 1];
        if (lastPress.digit === lastPressedDTMF && lastPress.count >= 3) {
          shouldPreventDTMF = true;
        }
      }

      // Additional check: If we've pressed any digit recently and loop is detected,
      // prevent pressing to avoid getting stuck in loops
      if (loopDetected && loopCheck.confidence > 0.7 && lastPressedDTMF) {
        // Even if it's a different digit, if we're in a loop and already pressed,
        // wait for the system to respond instead of pressing again
        shouldPreventDTMF = true;
      }
    }

    // Get DTMF decision (only if we're not preventing it)
    if (!shouldPreventDTMF) {
      dtmfDecision =
        await aiDTMFService.understandCallPurposeAndPressDTMF(
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

