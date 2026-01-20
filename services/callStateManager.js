/**
 * Call State Manager
 * Manages state for each call (IVR navigation, conversation history, etc.)
 */

class CallStateManager {
  constructor() {
    this.callStates = new Map();
  }

  /**
   * Get or create call state
   */
  getCallState(callSid) {
    if (!this.callStates.has(callSid)) {
      this.callStates.set(callSid, {
        callSid,
        menuLevel: 0,
        lastMenuOptions: [],
        partialSpeech: '',
        conversationHistory: [],
        scenarioId: null,
        createdAt: new Date()
      });
    }
    return this.callStates.get(callSid);
  }

  /**
   * Update call state
   */
  updateCallState(callSid, updates) {
    const state = this.getCallState(callSid);
    Object.assign(state, updates);
    return state;
  }

  /**
   * Add to conversation history
   */
  addToHistory(callSid, entry) {
    const state = this.getCallState(callSid);
    if (!state.conversationHistory) {
      state.conversationHistory = [];
    }
    state.conversationHistory.push({
      timestamp: new Date(),
      ...entry
    });
    // Keep only last 20 entries
    if (state.conversationHistory.length > 20) {
      state.conversationHistory.shift();
    }
  }

  /**
   * Clear call state
   */
  clearCallState(callSid) {
    this.callStates.delete(callSid);
  }

  /**
   * Clean up old call states (older than 1 hour)
   */
  cleanup() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const [callSid, state] of this.callStates.entries()) {
      if (state.createdAt < oneHourAgo) {
        this.callStates.delete(callSid);
      }
    }
  }
}

// Singleton instance
const callStateManager = new CallStateManager();

// Cleanup every 30 minutes
setInterval(() => {
  callStateManager.cleanup();
}, 30 * 60 * 1000);

module.exports = callStateManager;


