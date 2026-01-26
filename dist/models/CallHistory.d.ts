/**
 * Call History Model
 * MongoDB schema for storing call history
 */
import { Document, Model } from 'mongoose';
export interface ConversationEntry {
    type: 'user' | 'ai' | 'system';
    text: string;
    timestamp?: Date;
}
export interface DTMFPress {
    digit: string;
    reason?: string;
    timestamp?: Date;
}
export interface MenuOption {
    digit: string;
    option: string;
}
export interface CallEvent {
    eventType: 'conversation' | 'dtmf' | 'ivr_menu' | 'transfer' | 'termination';
    type?: string;
    text?: string;
    digit?: string;
    reason?: string;
    menuOptions?: MenuOption[];
    transferNumber?: string;
    success?: boolean;
    timestamp?: Date;
}
export interface CallHistoryMetadata {
    to?: string;
    from?: string;
    transferNumber?: string;
    callPurpose?: string;
    customInstructions?: string;
}
export interface ICallHistory extends Document {
    callSid: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    status: 'in-progress' | 'completed' | 'failed' | 'terminated';
    metadata: CallHistoryMetadata;
    conversation: ConversationEntry[];
    dtmfPresses: DTMFPress[];
    events: CallEvent[];
    createdAt?: Date;
    updatedAt?: Date;
}
declare const CallHistory: Model<ICallHistory>;
export default CallHistory;
//# sourceMappingURL=CallHistory.d.ts.map