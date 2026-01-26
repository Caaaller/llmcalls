/**
 * Call History Model
 * MongoDB schema for storing call history
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

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
  type?: string; // For conversation events: 'user', 'ai', 'system'
  text?: string; // For conversation events
  digit?: string; // For DTMF events
  reason?: string; // For DTMF and termination events
  menuOptions?: MenuOption[]; // For IVR menu events
  transferNumber?: string; // For transfer events
  success?: boolean; // For transfer events
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

const conversationSchema = new Schema<ConversationEntry>({
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

const dtmfPressSchema = new Schema<DTMFPress>({
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

const eventSchema = new Schema<CallEvent>({
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

const callHistorySchema = new Schema<ICallHistory>({
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

const CallHistory: Model<ICallHistory> = mongoose.model<ICallHistory>('CallHistory', callHistorySchema);

export default CallHistory;


