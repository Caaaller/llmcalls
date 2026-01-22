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
  // - "for order issues, press 1, for returns press 2" (description before press)
  // - "Press 3 for technical support, press 4." (incomplete last option)
  
  // Pattern 1: "for X, press Y" or "to X, press Y" (description BEFORE press)
  // Example: "for order issues, press 1, for returns press 2"
  const reversePattern = /(?:for|to)\s+([^,]+?),\s*press\s*(\d+)/gi;
  let match;
  
  while ((match = reversePattern.exec(speech)) !== null) {
    const option = match[1].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    const digit = match[2];
    if (digit && option && option.length > 0) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 2: "Press X, to Y" or "Press X, for Y" (standard format)
  const pressPattern1 = /press\s*(\d+)\s*[,.]?\s*(?:to|for)\s+([^,]+?)(?=\s*[,.]?\s*(?:press|online|$))/gi;
  
  while ((match = pressPattern1.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 3: "Press X for Y" (without comma, more flexible)
  const pressPattern2 = /press\s*(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = pressPattern2.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 4: "X for Y" (without "press")
  const simplePattern = /(?:^|\s)(\d+)\s+for\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/gi;
  while ((match = simplePattern.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 5: Handle "online press 2" or "press 2 online"
  const onlinePattern = /(?:online\s+)?press\s*(\d+)(?:\s+online)?[,.]?\s*(?:for|to)\s+([^,]+?)(?=\s*[,.]?\s*(?:press|$))/gi;
  while ((match = onlinePattern.exec(speech)) !== null) {
    const digit = match[1];
    const option = match[2].trim().replace(/^[,.\s]+|[,.\s]+$/g, '');
    if (digit && option && option.length > 0 && !options.some(opt => opt.digit === digit)) {
      options.push({ digit, option: option.toLowerCase() });
    }
  }
  
  // Pattern 6: Handle standalone "press X" or "press X." at the end (incomplete option)
  // Example: "Press 3 for technical support, press 4."
  // This should extract "press 4" even if it doesn't have a description
  const allPressMatches = [...speech.matchAll(/press\s*(\d+)/gi)];
  for (const pressMatch of allPressMatches) {
    const digit = pressMatch[1];
    // Check if this digit is already in options
    if (!options.some(opt => opt.digit === digit)) {
      // Try to find a description after this press
      const afterPress = speech.substring(pressMatch.index + pressMatch[0].length);
      const descMatch = afterPress.match(/^\s*(?:for|to)\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/i);
      if (descMatch) {
        const option = descMatch[1].trim();
        if (option && option.length > 0) {
          options.push({ digit, option: option.toLowerCase() });
        }
      } else {
        // No description found - this is an incomplete option, but we'll still record it
        // The incomplete menu detector will handle this
        options.push({ digit, option: '' });
      }
    }
  }
  
  // Remove duplicates (keep first occurrence)
  const uniqueOptions = [];
  const seen = new Set();
  for (const opt of options) {
    const key = opt.digit;
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
 * Check if IVR menu appears incomplete
 * Returns true if menu seems incomplete (e.g., only one option, sentence doesn't end properly)
 */
function isIncompleteMenu(speech, menuOptions) {
  // Count how many "Press X" patterns we see in the speech
  const pressMatches = (speech.match(/press\s+\d+/gi) || []).length;
  
  // If we found multiple "Press X" patterns but extracted fewer options, menu is incomplete
  if (pressMatches > menuOptions.length) {
    console.log(`   ⚠️ Found ${pressMatches} "Press X" patterns but only extracted ${menuOptions.length} options - menu incomplete`);
    return true;
  }
  
  // If we only found 1 option but there might be more, check if speech suggests continuation
  if (menuOptions.length === 1) {
    const trimmed = speech.trim();
    // Check if speech ends with continuation words or patterns
    const endsWithContinuation = /(,|and|or|for|to|press)$/i.test(trimmed);
    const endsWithPeriod = /\.$/.test(trimmed);
    
    // If it ends with a comma or continuation word, likely more options coming
    if (endsWithContinuation && !endsWithPeriod) {
      console.log(`   ⚠️ Only 1 option found and speech ends with continuation word - waiting for more`);
      return true;
    }
    
    // If speech ends with "press" or "press X" without description, likely incomplete
    const endsWithIncompletePress = /\bpress\s+\d+\.?\s*$/i.test(trimmed);
    if (endsWithIncompletePress) {
      console.log(`   ⚠️ Speech ends with incomplete "Press X" pattern - waiting for description`);
      return true;
    }
  }
  
  // Check if any option is missing a description (empty or very short)
  const hasIncompleteOption = menuOptions.some(opt => {
    const optionText = opt.option.trim().toLowerCase();
    // If option is empty or very short, it's incomplete
    return !optionText || optionText.length < 2;
  });
  
  if (hasIncompleteOption && menuOptions.length <= 2) {
    console.log(`   ⚠️ Found incomplete option(s) - waiting for complete menu`);
    return true;
  }
  
  // If we have 2+ complete options, menu is likely complete
  const completeOptions = menuOptions.filter(opt => opt.option && opt.option.trim().length >= 2);
  if (completeOptions.length >= 2) {
    return false; // Menu is complete
  }
  
  // Check if speech ends mid-sentence (no punctuation, or ends with comma/and/or)
  const trimmed = speech.trim();
  const endsWithPunctuation = /[.!?]$/.test(trimmed);
  const endsWithContinuation = /(,|and|or|for|to)$/i.test(trimmed);
  
  // If it ends with continuation words without punctuation, likely incomplete
  if (endsWithContinuation && !endsWithPunctuation) {
    return true;
  }
  
  return false;
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
  extractDirectDigit,
  isIncompleteMenu
};
