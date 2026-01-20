/**
 * IVR Detection and Navigation Utilities
 */

/**
 * Extract DTMF options from IVR menu speech
 */
function extractMenuOptions(speech) {
  const options = [];
  const speechLower = speech.toLowerCase();
  
  // First, try to extract all "Press X" patterns with their associated options
  // Handle patterns like:
  // - "Press 1, to order medicine, online press 2, for Dr. Appointment"
  // - "Press 1 for X and press 2 for Y"
  // - "Press 1 to X, press 2 to Y"
  // - "1 for X, 2 for Y"
  
  // Pattern 1: "Press X, to Y" or "Press X, for Y"
  const pressPattern1 = /press\s*(\d+)\s*[,.]?\s*(?:to|for)\s+([^,]+?)(?=\s*[,.]?\s*(?:press|online|$))/gi;
  let match;
  
  while ((match = pressPattern1.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 2: "Press X for Y" (without comma)
  const pressPattern2 = /press\s*(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|$))/gi;
  while ((match = pressPattern2.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 3: "X for Y" (without "press")
  const simplePattern = /(?:^|\s)(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|$))/gi;
  while ((match = simplePattern.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 4: Handle "online press 2" or "press 2 online"
  const onlinePattern = /(?:online\s+)?press\s*(\d+)(?:\s+online)?[,.]?\s*(?:for|to)\s+([^,]+?)(?=\s*[,.]?\s*(?:press|$))/gi;
  while ((match = onlinePattern.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Remove duplicates
  const uniqueOptions = [];
  const seen = new Set();
  for (const opt of options) {
    const key = `${opt.digit}-${opt.option}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueOptions.push(opt);
    }
  }
  
  return uniqueOptions;
}

/**
 * Extract digit from direct instruction like "Please press 1" or "Press 1"
 * This is more aggressive - if "press" + digit is mentioned, extract it
 * Also handles: "choose 1", "select 1", "option 1", etc.
 */
function extractDirectDigit(speech) {
  // Pattern: "Please press 1" or "Press 1" or "press 1" or "press one"
  // Also handles: "press 1 for X" or "press 1, to X"
  // Also handles: "choose 1", "select 1", "option 1", "choose 1 of"
  const directPatterns = [
    /(?:please\s+)?press\s+(\d+|one|two|three|four|five|six|seven|eight|nine|zero)/i,
    /press\s+(\d+)\s*(?:for|to|,|\.|$)/i,
    /\b(\d+)\s*(?:for|to)\s+.*press/i,
    /(?:please\s+)?(?:choose|select|pick)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|zero)/i,
    /(?:choose|select)\s+(\d+)\s+of/i,
    /option\s+(\d+)/i,
    /\b(\d+)\s+of\s+the\s+following/i
  ];
  
  for (const pattern of directPatterns) {
    const match = speech.match(pattern);
    if (match && match[1]) {
      const digit = match[1];
      // Convert word to digit if needed
      const wordToDigit = {
        'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
        'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'zero': '0'
      };
      const extractedDigit = wordToDigit[digit.toLowerCase()] || digit;
      console.log(`   🔢 Extracted digit from direct instruction: "${digit}" -> ${extractedDigit}`);
      return extractedDigit;
    }
  }
  
  return null;
}

/**
 * Find the digit to press
 * Priority:
 * 1. Direct instruction (e.g., "Please press 1") - ALWAYS press if detected
 * 2. Menu options matching keywords
 * 3. If no match, return null
 */
function findAppointmentDigit(menuOptions, targetKeywords, speech = '') {
  // FIRST PRIORITY: Check for direct instruction like "Please press 1"
  // If "press" + digit is mentioned, ALWAYS press it regardless of keywords
  const directDigit = extractDirectDigit(speech);
  if (directDigit) {
    console.log(`   ✅ Found direct instruction: "Press ${directDigit}" -> Pressing ${directDigit} (ignoring keywords)`);
    return directDigit;
  }
  
  // SECOND PRIORITY: Match menu options with keywords
  if (!menuOptions || menuOptions.length === 0) {
    return null;
  }
  
  // Expanded keywords for appointment booking
  const keywords = targetKeywords || [
    'appointment', 'appt', 'doctor', 'dr', 'cardiologist', 
    'booking', 'schedule', 'visit', 'consultation', 'medical'
  ];
  
  console.log('   Options found:', menuOptions.map(opt => `${opt.digit}: ${opt.option}`).join(', '));
  
  // Try to find exact match first
  for (const opt of menuOptions) {
    for (const keyword of keywords) {
      if (opt.option.includes(keyword.toLowerCase())) {
        console.log(`   ✅ Found matching option: "${opt.option}" (matched "${keyword}") -> Press ${opt.digit}`);
        return opt.digit;
      }
    }
  }
  
  return null;
}

/**
 * Check if speech contains IVR menu patterns
 */
function isIVRMenu(speech) {
  const speechLower = speech.toLowerCase();
  
  return speechLower.includes('press') || 
         /\b(this|number|option|dial|enter|select)\s*\d+/i.test(speech) ||
         /\b\d+\s+(for|to|press|select)/i.test(speech) ||
         (speechLower.includes('for') && /\d/.test(speech)) ||
         (speechLower.includes('to') && /\d/.test(speech));
}

module.exports = {
  extractMenuOptions,
  findAppointmentDigit,
  isIVRMenu,
  extractDirectDigit
};

