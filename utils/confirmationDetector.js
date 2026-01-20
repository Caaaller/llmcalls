/**
 * Confirmation Question Detection
 * Detects yes/no confirmation questions that need simple affirmative/negative responses
 */

/**
 * Check if speech contains a confirmation question (yes/no question)
 */
function isConfirmationQuestion(speechResult) {
  if (!speechResult || typeof speechResult !== 'string') {
    return false;
  }
  
  const speechLower = speechResult.toLowerCase();
  
  // Patterns that indicate confirmation questions
  const confirmationPatterns = [
    // "Just to confirm..." patterns
    /\bjust\s+to\s+confirm\b/i,
    /\bto\s+confirm\b/i,
    /\bconfirm(?:ing|ation)?\s+(?:that|if|your|the)\b/i,
    
    // "Is your X Y?" patterns
    /\bis\s+(?:your|the)\s+[^?]+\?/i,
    /\bis\s+it\s+[^?]+\?/i,
    
    // "Are you..." patterns
    /\bare\s+you\s+[^?]+\?/i,
    
    // "Does that sound..." patterns
    /\bdoes\s+that\s+sound\s+(?:right|correct|good|ok)\??/i,
    
    // "Can you confirm..." patterns
    /\bcan\s+you\s+confirm\b/i,
    /\bcould\s+you\s+confirm\b/i,
    
    // "Is that correct?" patterns
    /\bis\s+that\s+(?:correct|right|accurate)\??/i,
    /\b(?:that|this)\s+correct\??/i,
    
    // "Do you have..." confirmation patterns
    /\bdo\s+you\s+have\s+[^?]+\?/i,
    
    // "Is your [field] [value]?" patterns (like "Is your ZIP code 90210?")
    /\bis\s+your\s+\w+\s+(\d+|[^?]+)\??/i,
    
    // "Your [field] is [value], right?" patterns
    /\byour\s+\w+\s+is\s+[^?]+\s*(?:right|correct|is\s+that\s+right)\??/i,
    
    // "Let me confirm..." patterns
    /\blet\s+(?:me|us)\s+confirm\b/i,
    
    // "I want to confirm..." patterns
    /\b(?:i\s+want\s+to|i'd\s+like\s+to)\s+confirm\b/i
  ];
  
  return confirmationPatterns.some(pattern => pattern.test(speechResult));
}

/**
 * Extract the value being confirmed (if any)
 * Useful for context-aware responses
 */
function extractConfirmationValue(speechResult) {
  if (!speechResult || typeof speechResult !== 'string') {
    return null;
  }
  
  // Try to extract values like "90210" from "Is your ZIP code 90210?"
  const valuePatterns = [
    /\b(?:zip\s+code|phone|email|order|account)\s+(\d+)/i,
    /\bis\s+(\d+)/i,
    /\byour\s+\w+\s+is\s+(\d+)/i
  ];
  
  for (const pattern of valuePatterns) {
    const match = speechResult.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Determine if this is a positive confirmation (should say "yes")
 * vs negative confirmation (should say "no")
 */
function requiresPositiveConfirmation(speechResult) {
  if (!speechResult || typeof speechResult !== 'string') {
    return true; // Default to yes
  }
  
  const speechLower = speechResult.toLowerCase();
  
  // Patterns that suggest negative confirmation
  const negativePatterns = [
    /\b(?:not|wrong|incorrect|different)\b/i,
    /\bisn't\b/i,
    /\bdoesn't\b/i
  ];
  
  // If contains negative patterns, might need "no"
  // But most confirmations are positive (confirming what was said)
  return !negativePatterns.some(pattern => pattern.test(speechResult));
}

module.exports = {
  isConfirmationQuestion,
  extractConfirmationValue,
  requiresPositiveConfirmation
};

