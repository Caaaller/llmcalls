/**
 * Call History Model
 * MongoDB schema for storing call history
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { CallStatus } from '../types/callStatus';

// Array of valid CallStatus values for Mongoose enum
const CALL_STATUSES: CallStatus[] = [
  'in-progress',
  'completed',
  'failed',
  'terminated',
];

export type EndReason =
  | 'transfer_completed'
  | 'ai_hangup_voicemail'
  | 'ai_hangup_closed'
  | 'ai_hangup_dead_end'
  | 'ai_hangup_hold_timeout'
  | 'ivr_hangup'
  | 'user_cancelled'
  | 'application_error'
  | 'other';

const END_REASONS: EndReason[] = [
  'transfer_completed',
  'ai_hangup_voicemail',
  'ai_hangup_closed',
  'ai_hangup_dead_end',
  'ai_hangup_hold_timeout',
  'ivr_hangup',
  'user_cancelled',
  'application_error',
  'other',
];

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

import { MenuOption } from '../types/menu';

export interface TurnTimingMetadata {
  speechStartedAt?: number;
  speechEndedAt: number;
  ttsDispatchedAt: number;
  ttsSpeakStartedAt: number;
  /** Time between user starting to speak and Deepgram declaring speech final. */
  endpointingMs?: number;
  /** User-perceived latency: end-of-speech → audio starts playing back. */
  perceivedMs: number;
  /** Epoch ms when the IVR navigator LLM emitted its first streaming token. */
  firstTokenAt?: number;
  /** Epoch ms when the streamed "speech" field closed (mid-stream). */
  speechFieldCompleteAt?: number;
  /** Epoch ms when the first buffered sentence was dispatched to TTS. */
  firstSentenceDispatchedAt?: number;
  /** Epoch ms when the LLM stream fully completed. */
  streamCompleteAt?: number;
  /** True if SpeechFieldExtractor missed mid-stream and fell back to
   * dispatching the parsed speech post-stream. */
  streamFallbackFired?: boolean;
  /** Derived: speechFieldCompleteAt - firstTokenAt. How much of the stream
   * elapsed before the "speech" field closed. */
  speechCompleteDeltaMs?: number;
  /** Derived: streamCompleteAt - speechFieldCompleteAt. How long the stream
   * kept going after the speech field closed. */
  streamTailMs?: number;
}

export interface CallEvent {
  eventType:
    | 'conversation'
    | 'dtmf'
    | 'ivr_menu'
    | 'transfer'
    | 'termination'
    | 'hold'
    | 'info_request'
    | 'info_response'
    | 'turn_timing';
  type?: string; // For conversation events: 'user', 'ai', 'system'; for turn_timing: 'turn_timing'
  text?: string; // For conversation events
  digit?: string; // For DTMF events
  reason?: string; // For DTMF and termination events
  menuOptions?: MenuOption[]; // For IVR menu events
  transferNumber?: string; // For transfer events
  success?: boolean; // For transfer events
  timestamp?: Date;
  metadata?: TurnTimingMetadata; // For turn_timing events
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
  userId?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: CallStatus;
  metadata: CallHistoryMetadata;
  conversation: ConversationEntry[];
  dtmfPresses: DTMFPress[];
  events: CallEvent[];
  recordingUrl?: string;
  dgReconnects?: number;
  dgSilentMs?: number;
  endReason?: EndReason;
  endReasonDetail?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const conversationSchema = new Schema<ConversationEntry>(
  {
    type: {
      type: String,
      enum: ['user', 'ai', 'system'],
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const dtmfPressSchema = new Schema<DTMFPress>(
  {
    digit: {
      type: String,
      required: true,
    },
    reason: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const eventSchema = new Schema<CallEvent>(
  {
    eventType: {
      type: String,
      enum: [
        'conversation',
        'dtmf',
        'ivr_menu',
        'transfer',
        'termination',
        'hold',
        'info_request',
        'info_response',
        'turn_timing',
      ],
      required: true,
    },
    type: String,
    text: String,
    digit: String,
    reason: String,
    menuOptions: [
      {
        digit: String,
        option: String,
      },
    ],
    transferNumber: String,
    success: Boolean,
    timestamp: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      speechStartedAt: Number,
      speechEndedAt: Number,
      ttsDispatchedAt: Number,
      ttsSpeakStartedAt: Number,
      endpointingMs: Number,
      perceivedMs: Number,
      firstTokenAt: Number,
      speechFieldCompleteAt: Number,
      firstSentenceDispatchedAt: Number,
      streamCompleteAt: Number,
      streamFallbackFired: Boolean,
      speechCompleteDeltaMs: Number,
      streamTailMs: Number,
    },
  },
  { _id: false }
);

const callHistorySchema = new Schema<ICallHistory>(
  {
    callSid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: Date,
    duration: Number,
    status: {
      type: String,
      enum: CALL_STATUSES,
      default: 'in-progress',
      index: true,
    },
    metadata: {
      to: String,
      from: String,
      transferNumber: String,
      callPurpose: String,
      customInstructions: String,
    },
    conversation: [conversationSchema],
    dtmfPresses: [dtmfPressSchema],
    events: [eventSchema],
    recordingUrl: String,
    dgReconnects: { type: Number, default: 0 },
    dgSilentMs: { type: Number, default: 0 },
    endReason: {
      type: String,
      enum: END_REASONS,
      index: true,
    },
    endReasonDetail: { type: String },
  },
  {
    timestamps: true,
  }
);

callHistorySchema.index({ startTime: -1 });
callHistorySchema.index({ status: 1, startTime: -1 });

const CallHistory: Model<ICallHistory> = mongoose.model<ICallHistory>(
  'CallHistory',
  callHistorySchema
);

export default CallHistory;
