"use strict";
/**
 * Call History Service
 * Stores and retrieves call history with full conversation logs using MongoDB
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const CallHistory_1 = __importDefault(require("../models/CallHistory"));
const database_1 = require("./database");
function isMongoAvailable() {
    return (0, database_1.isDbConnected)();
}
class CallHistoryService {
    /**
     * Start tracking a new call
     */
    async startCall(callSid, metadata = {}) {
        if (!isMongoAvailable()) {
            console.log('⚠️  MongoDB not connected. Call history will not be saved.');
            return;
        }
        try {
            const callHistory = new CallHistory_1.default({
                callSid,
                startTime: new Date(),
                status: 'in-progress',
                metadata: {
                    to: metadata.to || undefined,
                    from: metadata.from || undefined,
                    transferNumber: metadata.transferNumber || undefined,
                    callPurpose: metadata.callPurpose || undefined,
                    customInstructions: metadata.customInstructions || undefined
                },
                conversation: [],
                dtmfPresses: [],
                events: []
            });
            await callHistory.save();
            console.log(`📞 Started tracking call: ${callSid}`);
        }
        catch (error) {
            if (error.code === 11000) {
                console.log(`📞 Call ${callSid} already exists, updating...`);
                await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                    $set: {
                        status: 'in-progress',
                        startTime: new Date(),
                        metadata: {
                            to: metadata.to || undefined,
                            from: metadata.from || undefined,
                            transferNumber: metadata.transferNumber || undefined,
                            callPurpose: metadata.callPurpose || undefined,
                            customInstructions: metadata.customInstructions || undefined
                        }
                    }
                });
            }
            else {
                console.error('❌ Error starting call tracking:', error.message);
                throw error;
            }
        }
    }
    /**
     * Add a conversation event
     */
    async addConversation(callSid, type, text, timestamp = null) {
        if (!isMongoAvailable())
            return;
        try {
            const conversationEntry = {
                type,
                text,
                timestamp: timestamp || new Date()
            };
            await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                $push: {
                    conversation: conversationEntry,
                    events: {
                        ...conversationEntry,
                        eventType: 'conversation'
                    }
                }
            });
        }
        catch (error) {
            console.error('❌ Error adding conversation:', error.message);
        }
    }
    /**
     * Record a DTMF press
     */
    async addDTMF(callSid, digit, reason = null, timestamp = null) {
        if (!isMongoAvailable())
            return;
        try {
            const dtmfEvent = {
                digit,
                reason: reason || undefined,
                timestamp: timestamp || new Date()
            };
            await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                $push: {
                    dtmfPresses: dtmfEvent,
                    events: {
                        ...dtmfEvent,
                        eventType: 'dtmf'
                    }
                }
            });
        }
        catch (error) {
            console.error('❌ Error adding DTMF:', error.message);
        }
    }
    /**
     * Record an IVR menu detection
     */
    async addIVRMenu(callSid, menuOptions, timestamp = null) {
        if (!isMongoAvailable())
            return;
        try {
            await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                $push: {
                    events: {
                        eventType: 'ivr_menu',
                        menuOptions,
                        timestamp: timestamp || new Date()
                    }
                }
            });
        }
        catch (error) {
            console.error('❌ Error adding IVR menu:', error.message);
        }
    }
    /**
     * Record a transfer attempt
     */
    async addTransfer(callSid, transferNumber, success = false, timestamp = null) {
        if (!isMongoAvailable())
            return;
        try {
            await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                $push: {
                    events: {
                        eventType: 'transfer',
                        transferNumber,
                        success,
                        timestamp: timestamp || new Date()
                    }
                }
            });
        }
        catch (error) {
            console.error('❌ Error adding transfer:', error.message);
        }
    }
    /**
     * Record a termination
     */
    async addTermination(callSid, reason, timestamp = null) {
        if (!isMongoAvailable())
            return;
        try {
            await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                $push: {
                    events: {
                        eventType: 'termination',
                        reason,
                        timestamp: timestamp || new Date()
                    }
                }
            });
        }
        catch (error) {
            console.error('❌ Error adding termination:', error.message);
        }
    }
    /**
     * End a call
     */
    async endCall(callSid, status = 'completed') {
        if (!isMongoAvailable())
            return;
        try {
            const call = await CallHistory_1.default.findOne({ callSid });
            if (!call)
                return;
            const endTime = new Date();
            const duration = endTime.getTime() - call.startTime.getTime();
            await CallHistory_1.default.findOneAndUpdate({ callSid }, {
                $set: {
                    endTime,
                    duration,
                    status
                }
            });
        }
        catch (error) {
            console.error('❌ Error ending call:', error.message);
        }
    }
    /**
     * Get call history by callSid
     */
    async getCall(callSid) {
        if (!isMongoAvailable())
            return null;
        try {
            const call = await CallHistory_1.default.findOne({ callSid }).lean();
            return call;
        }
        catch (error) {
            console.error('❌ Error getting call:', error.message);
            return null;
        }
    }
    /**
     * Get all calls
     */
    async getAllCalls(limit = 100) {
        if (!isMongoAvailable())
            return [];
        try {
            const calls = await CallHistory_1.default.find()
                .sort({ startTime: -1 })
                .limit(limit)
                .lean();
            return calls;
        }
        catch (error) {
            console.error('❌ Error getting all calls:', error.message);
            return [];
        }
    }
    /**
     * Get recent calls
     */
    async getRecentCalls(limit = 20) {
        return this.getAllCalls(limit);
    }
    /**
     * Clean up old calls
     */
    async cleanup(daysOld = 7) {
        if (!isMongoAvailable())
            return;
        try {
            const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
            const result = await CallHistory_1.default.deleteMany({
                startTime: { $lt: cutoffDate }
            });
            if (result.deletedCount && result.deletedCount > 0) {
                console.log(`🧹 Cleaned up ${result.deletedCount} old calls`);
            }
        }
        catch (error) {
            console.error('❌ Error cleaning up calls:', error.message);
        }
    }
    /**
     * Get call statistics
     */
    async getStatistics() {
        try {
            const totalCalls = await CallHistory_1.default.countDocuments();
            const inProgress = await CallHistory_1.default.countDocuments({ status: 'in-progress' });
            const completed = await CallHistory_1.default.countDocuments({ status: 'completed' });
            const failed = await CallHistory_1.default.countDocuments({ status: 'failed' });
            const terminated = await CallHistory_1.default.countDocuments({ status: 'terminated' });
            return {
                totalCalls,
                inProgress,
                completed,
                failed,
                terminated
            };
        }
        catch (error) {
            console.error('❌ Error getting statistics:', error.message);
            return null;
        }
    }
}
// Singleton instance
const callHistoryService = new CallHistoryService();
// Cleanup old calls every hour
setInterval(() => {
    callHistoryService.cleanup(7).catch(console.error);
}, 60 * 60 * 1000);
exports.default = callHistoryService;
//# sourceMappingURL=callHistoryService.js.map