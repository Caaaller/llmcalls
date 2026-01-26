/**
 * Call History Service
 * Stores and retrieves call history with full conversation logs using MongoDB
 */
import { MenuOption } from '../models/CallHistory';
export interface CallMetadata {
    to?: string;
    from?: string;
    transferNumber?: string;
    callPurpose?: string;
    customInstructions?: string;
}
declare class CallHistoryService {
    /**
     * Start tracking a new call
     */
    startCall(callSid: string, metadata?: CallMetadata): Promise<void>;
    /**
     * Add a conversation event
     */
    addConversation(callSid: string, type: 'user' | 'ai' | 'system', text: string, timestamp?: Date | null): Promise<void>;
    /**
     * Record a DTMF press
     */
    addDTMF(callSid: string, digit: string, reason?: string | null, timestamp?: Date | null): Promise<void>;
    /**
     * Record an IVR menu detection
     */
    addIVRMenu(callSid: string, menuOptions: MenuOption[], timestamp?: Date | null): Promise<void>;
    /**
     * Record a transfer attempt
     */
    addTransfer(callSid: string, transferNumber: string, success?: boolean, timestamp?: Date | null): Promise<void>;
    /**
     * Record a termination
     */
    addTermination(callSid: string, reason: string, timestamp?: Date | null): Promise<void>;
    /**
     * End a call
     */
    endCall(callSid: string, status?: 'completed' | 'failed' | 'terminated'): Promise<void>;
    /**
     * Get call history by callSid
     */
    getCall(callSid: string): Promise<(import("../models/CallHistory").ICallHistory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    }) | null>;
    /**
     * Get all calls
     */
    getAllCalls(limit?: number): Promise<(import("../models/CallHistory").ICallHistory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
    /**
     * Get recent calls
     */
    getRecentCalls(limit?: number): Promise<(import("../models/CallHistory").ICallHistory & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
    /**
     * Clean up old calls
     */
    cleanup(daysOld?: number): Promise<void>;
    /**
     * Get call statistics
     */
    getStatistics(): Promise<{
        totalCalls: number;
        inProgress: number;
        completed: number;
        failed: number;
        terminated: number;
    } | null>;
}
declare const callHistoryService: CallHistoryService;
export default callHistoryService;
//# sourceMappingURL=callHistoryService.d.ts.map