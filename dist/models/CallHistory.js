"use strict";
/**
 * Call History Model
 * MongoDB schema for storing call history
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const conversationSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: ['user', 'ai', 'system'],
        required: true
    },
    text: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });
const dtmfPressSchema = new mongoose_1.Schema({
    digit: {
        type: String,
        required: true
    },
    reason: String,
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });
const eventSchema = new mongoose_1.Schema({
    eventType: {
        type: String,
        enum: ['conversation', 'dtmf', 'ivr_menu', 'transfer', 'termination'],
        required: true
    },
    type: String,
    text: String,
    digit: String,
    reason: String,
    menuOptions: [{
            digit: String,
            option: String
        }],
    transferNumber: String,
    success: Boolean,
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });
const callHistorySchema = new mongoose_1.Schema({
    callSid: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    startTime: {
        type: Date,
        required: true,
        index: true
    },
    endTime: Date,
    duration: Number,
    status: {
        type: String,
        enum: ['in-progress', 'completed', 'failed', 'terminated'],
        default: 'in-progress',
        index: true
    },
    metadata: {
        to: String,
        from: String,
        transferNumber: String,
        callPurpose: String,
        customInstructions: String
    },
    conversation: [conversationSchema],
    dtmfPresses: [dtmfPressSchema],
    events: [eventSchema]
}, {
    timestamps: true
});
callHistorySchema.index({ startTime: -1 });
callHistorySchema.index({ status: 1, startTime: -1 });
const CallHistory = mongoose_1.default.model('CallHistory', callHistorySchema);
exports.default = CallHistory;
//# sourceMappingURL=CallHistory.js.map