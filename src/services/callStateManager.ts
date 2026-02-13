/**
 * Call State Manager
 * Manages state for each call (IVR navigation, conversation history, etc.)
 */

import { MenuOption } from '../types/menu';
import { TransferConfig } from '../config/transfer-config';

export interface ConversationEntry {
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp?: Date;
}

export interface CallState {
  callSid: string;
  menuLevel: number;
  lastMenuOptions: MenuOption[];
  partialSpeech: string;
  conversationHistory: ConversationEntry[];
  scenarioId: string | null;
  createdAt: Date;
  awaitingCompleteMenu?: boolean;
  partialMenuOptions?: MenuOption[];
  lastSpeech?: string;
  humanConfirmed?: boolean;
  awaitingHumanConfirmation?: boolean;
  awaitingTransferConfirmation?: boolean;
  transferConfirmed?: boolean;
  transferConfig?: TransferConfig;
  previousMenus?: MenuOption[][]; // Track previous menus for AI loop detection
  holdStartTime?: Date | null;
  customInstructions?: string;
  awaitingCompleteSpeech?: boolean; // Track if we're waiting for more speech
  incompleteSpeechWaitCount?: number; // Track how many times we've waited for incomplete speech
}

/**
 * Create a default call state object
 */
export function createDefaultCallState(callSid: string): CallState {
  return {
    callSid,
    menuLevel: 0,
    lastMenuOptions: [],
    partialSpeech: '',
    conversationHistory: [],
    scenarioId: null,
    createdAt: new Date(),
    previousMenus: [], // Initialize for AI loop detection
  };
}

class CallStateManager {
  private callStates: Map<string, CallState> = new Map();

  /**
   * Get or create call state
   */
  getCallState(callSid: string): CallState {
    if (!this.callStates.has(callSid)) {
      this.callStates.set(callSid, createDefaultCallState(callSid));
    }
    return this.callStates.get(callSid)!;
  }

  /**
   * Update call state
   */
  updateCallState(callSid: string, updates: Partial<CallState>): CallState {
    const state = this.getCallState(callSid);
    Object.assign(state, updates);
    return state;
  }

  /**
   * Add to conversation history
   */
  addToHistory(
    callSid: string,
    entry: Omit<ConversationEntry, 'timestamp'>
  ): void {
    const state = this.getCallState(callSid);
    if (!state.conversationHistory) {
      state.conversationHistory = [];
    }
    state.conversationHistory.push({
      timestamp: new Date(),
      ...entry,
    });
    // Keep only last 20 entries
    if (state.conversationHistory.length > 20) {
      state.conversationHistory.shift();
    }
  }

  /**
   * Clear call state
   */
  clearCallState(callSid: string): void {
    this.callStates.delete(callSid);
  }

  /**
   * Clean up old call states (older than 1 hour)
   */
  cleanup(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [callSid, state] of this.callStates.entries()) {
      if (state.createdAt < oneHourAgo) {
        this.callStates.delete(callSid);
      }
    }
  }
}

// Singleton instance
const callStateManager = new CallStateManager();

// Cleanup every 30 minutes
setInterval(
  () => {
    callStateManager.cleanup();
  },
  30 * 60 * 1000
);

export default callStateManager;
