"use strict";
/**
 * Confirmation Question Detection
 * Detects yes/no confirmation questions that need simple affirmative/negative responses
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isConfirmationQuestion = isConfirmationQuestion;
exports.extractConfirmationValue = extractConfirmationValue;
exports.requiresPositiveConfirmation = requiresPositiveConfirmation;
/**
 * Check if speech contains a confirmation question (yes/no question)
 */
function isConfirmationQuestion(speechResult) {
    if (!speechResult || typeof speechResult !== 'string') {
        return false;
    }
    const confirmationPatterns = [
        /\bjust\s+to\s+confirm\b/i,
        /\bto\s+confirm\b/i,
        /\bconfirm(?:ing|ation)?\s+(?:that|if|your|the)\b/i,
        /\bis\s+(?:your|the)\s+[^?]+\?/i,
        /\bis\s+it\s+[^?]+\?/i,
        /\bare\s+you\s+[^?]+\?/i,
        /\bdoes\s+that\s+sound\s+(?:right|correct|good|ok)\??/i,
        /\bcan\s+you\s+confirm\b/i,
        /\bcould\s+you\s+confirm\b/i,
        /\bis\s+that\s+(?:correct|right|accurate)\??/i,
        /\b(?:that|this)\s+correct\??/i,
        /\bdo\s+you\s+have\s+[^?]+\?/i,
        /\bis\s+your\s+\w+\s+(\d+|[^?]+)\??/i,
        /\byour\s+\w+\s+is\s+[^?]+\s*(?:right|correct|is\s+that\s+right)\??/i,
        /\blet\s+(?:me|us)\s+confirm\b/i,
        /\b(?:i\s+want\s+to|i'd\s+like\s+to)\s+confirm\b/i
    ];
    return confirmationPatterns.some(pattern => pattern.test(speechResult));
}
/**
 * Extract the value being confirmed (if any)
 */
function extractConfirmationValue(speechResult) {
    if (!speechResult || typeof speechResult !== 'string') {
        return null;
    }
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
 */
function requiresPositiveConfirmation(speechResult) {
    if (!speechResult || typeof speechResult !== 'string') {
        return true;
    }
    const negativePatterns = [
        /\b(?:not|wrong|incorrect|different)\b/i,
        /\bisn't\b/i,
        /\bdoesn't\b/i
    ];
    return !negativePatterns.some(pattern => pattern.test(speechResult));
}
//# sourceMappingURL=confirmationDetector.js.map