/**
 * Call State Manager
 * Manages state for each call (IVR navigation, conversation history, etc.)
 */

import { MenuOption } from '../types/menu';
import { TransferConfig } from '../config/transfer-config';
import { ActionHistoryEntry } from '../config/prompts';

/**
 * Normalize a US phone number to 10 digits for matching.
 * Strips non-digits, then removes leading "1" if 11 digits (US country code).
 */
function normalizePhoneForMatch(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

export { normalizePhoneForMatch };

export interface ConversationEntry {
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp?: Date;
}

export interface PendingInfoRequest {
  requestedInfo: string;
  requestedAt: Date;
  dataEntryMode?: 'dtmf' | 'speech' | 'none';
  userResponse?: string;
  respondedAt?: Date;
  respondedVia?: 'sms' | 'web';
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
  transferAnnounced?: boolean;
  awaitingHumanConfirmation?: boolean;
  pendingInfoRequest?: PendingInfoRequest;
  userPhone?: string;
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

  setPendingInfoRequest(
    callSid: string,
    requestedInfo: string,
    dataEntryMode?: 'dtmf' | 'speech' | 'none'
  ): void {
    const state = this.getCallState(callSid);
    state.pendingInfoRequest = {
      requestedInfo,
      requestedAt: new Date(),
      dataEntryMode,
    };
  }

  /**
   * Resolve a pending info request. First-write-wins (idempotent).
   * Returns true if this call actually resolved it, false if already resolved.
   */
  resolveInfoRequest(
    callSid: string,
    response: string,
    via: 'sms' | 'web'
  ): boolean {
    const state = this.callStates.get(callSid);
    if (!state?.pendingInfoRequest) return false;
    if (state.pendingInfoRequest.userResponse) return false;

    state.pendingInfoRequest.userResponse = response;
    state.pendingInfoRequest.respondedAt = new Date();
    state.pendingInfoRequest.respondedVia = via;

    // Inject into customInstructions so AI sees it on next turn
    const infoLabel = state.pendingInfoRequest.requestedInfo;
    const injection = `\nUser provided ${infoLabel}: ${response}`;
    state.customInstructions = (state.customInstructions || '') + injection;
    if (state.transferConfig) {
      state.transferConfig.customInstructions =
        (state.transferConfig.customInstructions || '') + injection;
    }

    return true;
  }

  /**
   * Find an active call by user phone number that has a pending (unresolved) info request.
   */
  findCallByUserPhone(phone: string): string | null {
    const normalized = normalizePhoneForMatch(phone);
    for (const [callSid, state] of this.callStates.entries()) {
      const statePhone = normalizePhoneForMatch(
        state.userPhone || state.transferConfig?.userPhone || ''
      );
      if (
        statePhone &&
        statePhone === normalized &&
        state.pendingInfoRequest &&
        !state.pendingInfoRequest.userResponse
      ) {
        return callSid;
      }
    }
    return null;
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
