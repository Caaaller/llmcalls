/**
 * Call State Manager
 * Manages state for each call (IVR navigation, conversation history, etc.)
 */

import { MenuOption } from '../types/menu';
import { TransferConfig } from '../config/transfer-config';
import { ActionHistoryEntry } from '../config/prompts';

export interface ConversationEntry {
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp?: Date;
}

export interface CallState {
  callSid: string;
  menuLevel: number;
  lastMenuOptions: MenuOption[];
  conversationHistory: ConversationEntry[];
  createdAt: Date;
  previousMenus: MenuOption[][];
  lastPressedDTMF?: string;
  transferConfig?: TransferConfig;
  customInstructions?: string;
  actionHistory: Array<ActionHistoryEntry>;
}

export function createDefaultCallState(callSid: string): CallState {
  return {
    callSid,
    menuLevel: 0,
    lastMenuOptions: [],
    conversationHistory: [],
    createdAt: new Date(),
    previousMenus: [],
    actionHistory: [],
  };
}

class CallStateManager {
  private callStates: Map<string, CallState> = new Map();

  getCallState(callSid: string): CallState {
    if (!this.callStates.has(callSid)) {
      this.callStates.set(callSid, createDefaultCallState(callSid));
    }
    return this.callStates.get(callSid)!;
  }

  updateCallState(callSid: string, updates: Partial<CallState>): CallState {
    const state = this.getCallState(callSid);
    Object.assign(state, updates);
    return state;
  }

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
    if (state.conversationHistory.length > 20) {
      state.conversationHistory.shift();
    }
  }

  addActionToHistory(callSid: string, entry: ActionHistoryEntry): void {
    const state = this.getCallState(callSid);
    if (!state.actionHistory) {
      state.actionHistory = [];
    }
    state.actionHistory.push(entry);
    if (state.actionHistory.length > 20) {
      state.actionHistory.shift();
    }
  }

  clearCallState(callSid: string): void {
    this.callStates.delete(callSid);
  }

  cleanup(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [callSid, state] of this.callStates.entries()) {
      if (state.createdAt < oneHourAgo) {
        this.callStates.delete(callSid);
      }
    }
  }
}

const callStateManager = new CallStateManager();

setInterval(
  () => {
    callStateManager.cleanup();
  },
  30 * 60 * 1000
);

export default callStateManager;
