/**
 * Call State Manager
 * Manages state for each call (IVR navigation, conversation history, etc.)
 */
import { MenuOption } from '../utils/ivrDetector';
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
    transferConfig?: any;
    loopDetector?: any;
    holdStartTime?: Date | null;
}
declare class CallStateManager {
    private callStates;
    /**
     * Get or create call state
     */
    getCallState(callSid: string): CallState;
    /**
     * Update call state
     */
    updateCallState(callSid: string, updates: Partial<CallState>): CallState;
    /**
     * Add to conversation history
     */
    addToHistory(callSid: string, entry: Omit<ConversationEntry, 'timestamp'>): void;
    /**
     * Clear call state
     */
    clearCallState(callSid: string): void;
    /**
     * Clean up old call states (older than 1 hour)
     */
    cleanup(): void;
}
declare const callStateManager: CallStateManager;
export default callStateManager;
//# sourceMappingURL=callStateManager.d.ts.map