"use strict";
/**
 * IVR Detection and Navigation Utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMenuOptions = extractMenuOptions;
exports.extractDirectDigit = extractDirectDigit;
exports.findAppointmentDigit = findAppointmentDigit;
exports.isIncompleteMenu = isIncompleteMenu;
exports.isIVRMenu = isIVRMenu;
/**
 * Extract DTMF options from IVR menu speech
 */
function extractMenuOptions(speech) {
    const options = [];
    // Pattern 1: "for X, press Y" or "to X, press Y" (description BEFORE press)
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
    // Pattern 6: Handle standalone "press X" or "press X." at the end
    const allPressMatches = [...speech.matchAll(/press\s*(\d+)/gi)];
    for (const pressMatch of allPressMatches) {
        const digit = pressMatch[1];
        if (!options.some(opt => opt.digit === digit)) {
            const afterPress = speech.substring(pressMatch.index + pressMatch[0].length);
            const descMatch = afterPress.match(/^\s*(?:for|to)\s+([^,]+?)(?=\s*(?:press|and|or|,|\.|$))/i);
            if (descMatch) {
                const option = descMatch[1].trim();
                if (option && option.length > 0) {
                    options.push({ digit, option: option.toLowerCase() });
                }
            }
            else {
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
 */
function extractDirectDigit(speech) {
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
 * Find the digit to press based on menu options and keywords
 */
function findAppointmentDigit(menuOptions, targetKeywords = [], speech = '') {
    // FIRST PRIORITY: Check for direct instruction
    const directDigit = extractDirectDigit(speech);
    if (directDigit) {
        console.log(`   ✅ Found direct instruction: "Press ${directDigit}" -> Pressing ${directDigit} (ignoring keywords)`);
        return directDigit;
    }
    // SECOND PRIORITY: Match menu options with keywords
    if (!menuOptions || menuOptions.length === 0) {
        return null;
    }
    const keywords = targetKeywords.length > 0 ? targetKeywords : [
        'appointment', 'appt', 'doctor', 'dr', 'cardiologist',
        'booking', 'schedule', 'visit', 'consultation', 'medical'
    ];
    console.log('   Options found:', menuOptions.map(opt => `${opt.digit}: ${opt.option}`).join(', '));
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
 */
function isIncompleteMenu(speech, menuOptions) {
    const pressMatches = (speech.match(/press\s+\d+/gi) || []).length;
    if (pressMatches > menuOptions.length) {
        console.log(`   ⚠️ Found ${pressMatches} "Press X" patterns but only extracted ${menuOptions.length} options - menu incomplete`);
        return true;
    }
    if (menuOptions.length === 1) {
        const trimmed = speech.trim();
        const endsWithContinuation = /(,|and|or|for|to|press)$/i.test(trimmed);
        const endsWithPeriod = /\.$/.test(trimmed);
        if (endsWithContinuation && !endsWithPeriod) {
            console.log(`   ⚠️ Only 1 option found and speech ends with continuation word - waiting for more`);
            return true;
        }
        const endsWithIncompletePress = /\bpress\s+\d+\.?\s*$/i.test(trimmed);
        if (endsWithIncompletePress) {
            console.log(`   ⚠️ Speech ends with incomplete "Press X" pattern - waiting for description`);
            return true;
        }
    }
    const hasIncompleteOption = menuOptions.some(opt => {
        const optionText = opt.option.trim().toLowerCase();
        return !optionText || optionText.length < 2;
    });
    if (hasIncompleteOption && menuOptions.length <= 2) {
        console.log(`   ⚠️ Found incomplete option(s) - waiting for complete menu`);
        return true;
    }
    const completeOptions = menuOptions.filter(opt => opt.option && opt.option.trim().length >= 2);
    if (completeOptions.length >= 2) {
        return false;
    }
    const trimmed = speech.trim();
    const endsWithPunctuation = /[.!?]$/.test(trimmed);
    const endsWithContinuation = /(,|and|or|for|to)$/i.test(trimmed);
    if (endsWithContinuation && !endsWithPunctuation) {
        return true;
    }
    return false;
}
/**
 * Check if speech contains IVR menu patterns
 */
function isIVRMenu(speech) {
    if (!speech || typeof speech !== 'string') {
        return false;
    }
    const speechLower = speech.toLowerCase();
    return speechLower.includes('press') ||
        /\b(this|number|option|dial|enter|select)\s*\d+/i.test(speech) ||
        /\b\d+\s+(for|to|press|select)/i.test(speech) ||
        (speechLower.includes('for') && /\d/.test(speech)) ||
        (speechLower.includes('to') && /\d/.test(speech));
}
//# sourceMappingURL=ivrDetector.js.map