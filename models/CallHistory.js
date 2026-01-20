/**
 * Call History Model
 * MongoDB schema for storing call history
 */

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
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

const dtmfPressSchema = new mongoose.Schema({
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

const eventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    enum: ['conversation', 'dtmf', 'ivr_menu', 'transfer', 'termination'],
    required: true
  },
  type: String, // For conversation events: 'user', 'ai', 'system'
  text: String, // For conversation events
  digit: String, // For DTMF events
  reason: String, // For DTMF and termination events
  menuOptions: [{
    digit: String,
    option: String
  }], // For IVR menu events
  transferNumber: String, // For transfer events
  success: Boolean, // For transfer events
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const callHistorySchema = new mongoose.Schema({
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
  duration: Number, // Duration in milliseconds
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
  timestamps: true // Adds createdAt and updatedAt
});

// Indexes for better query performance
callHistorySchema.index({ startTime: -1 }); // For sorting by newest first
callHistorySchema.index({ status: 1, startTime: -1 }); // For filtering by status

const CallHistory = mongoose.model('CallHistory', callHistorySchema);

module.exports = CallHistory;

