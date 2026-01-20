/**
 * Transfer Detection Utilities
 * Detects when a call should be transferred based on speech patterns
 */

/**
 * Check if speech indicates a transfer request
 */
function wantsTransfer(speechResult) {
  if (!speechResult || typeof speechResult !== 'string') {
    return false;
  }
  
  // Explicit transfer requests
  const patterns = [
    // Direct transfer requests
    /\btransfer\s+(?:the\s+)?(?:call|you|your\s+call)\b/i,
    /\b(?:your\s+)?call\s+(?:is\s+)?(?:being\s+)?transferred\b/i,
    /\b(?:being\s+)?transferred\b/i,
    /\bconnect\s+(?:you|your\s+call|the\s+call)\b/i,
    /\bconnect(?:ing)?\s+you\s+(?:with|to)\b/i,
    /\bput\s+(?:you|your\s+call)\s+through\b/i,
    /\btransfer\s+(?:you|your\s+call)\s+to\b/i,
    
    // Action phrases
    /\b(?:let\s+me|i\s+will|i'll|we\s+will|we'll)\s+transfer\b/i,
    /\b(?:let\s+me|i\s+will|i'll|we\s+will|we'll)\s+connect\s+you\b/i,
    
    // Hold + transfer/connect phrases
    /\b(?:please\s+)?hold\s+(?:while|as)\s+(?:your\s+call\s+is\s+being\s+)?(?:transferred|we\s+connect)/i,
    /\bhold\s+while\s+(?:we\s+)?(?:connect|transfer)/i,
    
    // Specific transfer phrases
    /\bspeak\s+to\s+(?:a\s+)?(?:real\s+)?(?:person|someone|human)\b/i,
    /\btransfer\s+to\s+(?:a\s+)?(?:real\s+)?(?:person|someone|human)\b/i,
    
    // Connecting to representative/agent/associate
    /\bconnect(?:ing)?\s+(?:you\s+)?(?:with|to)\s+(?:the\s+)?(?:next\s+)?(?:available\s+)?(?:representative|agent|person|associate)\b/i,
    
    // Walmart-specific: "connect you to the next available associate"
    /\b(?:please\s+)?hold\s+while\s+(?:we\s+)?connect\s+you\s+to\s+(?:the\s+)?(?:next\s+)?(?:available\s+)?(?:associate|representative|agent)\b/i,
    
    // "we connect you" patterns
    /\b(?:we\s+)?(?:will\s+)?connect\s+you\s+to\s+(?:the\s+)?(?:next\s+)?(?:available\s+)?(?:associate|representative|agent)\b/i
  ];
  
  return patterns.some(pattern => pattern.test(speechResult));
}

/**
 * Check if speech is incomplete (ends mid-sentence)
 */
function isIncompleteSpeech(speechResult) {
  if (!speechResult || speechResult.trim().length === 0) {
    return false;
  }
  
  // Check if it ends with punctuation
  const endsWithPunctuation = /[.!?]$/.test(speechResult.trim());
  
  // Check for common ending phrases
  const endsWithPhrase = /\b(thank\s+you|goodbye|bye|thanks)$/i.test(speechResult.trim());
  
  // Consider incomplete if:
  // - No punctuation at end
  // - Not ending with common phrases
  // - Has substantial content (more than 20 chars)
  return !endsWithPunctuation && 
         !endsWithPhrase && 
         speechResult.length > 20;
}

module.exports = {
  wantsTransfer,
  isIncompleteSpeech
};

