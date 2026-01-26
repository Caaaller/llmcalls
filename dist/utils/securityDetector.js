"use strict";
/**
 * Security Verification Detection
 * Detects security/verification requests that need special handling
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSecurityVerificationRequest = isSecurityVerificationRequest;
exports.getVerificationPreference = getVerificationPreference;
/**
 * Check if speech contains security verification requests
 */
function isSecurityVerificationRequest(speechResult) {
    if (!speechResult || typeof speechResult !== 'string') {
        return false;
    }
    const securityPatterns = [
        /\b(?:send|send you|we send|can we send)\s+(?:you\s+)?(?:a\s+)?(?:quick\s+)?(?:text|sms|message)\b/i,
        /\b(?:text|sms|message)\s+(?:to|for)\s+(?:verify|verification|complete|security)\b/i,
        /\b(?:verify|verification|complete)\s+(?:with|using|via)\s+(?:text|sms|message)\b/i,
        /\b(?:complete|finish)\s+(?:the\s+)?(?:security\s+)?(?:step|verification|process)\b/i,
        /\b(?:security\s+)?(?:step|verification|process)\s+(?:to|for)\s+(?:verify|complete)\b/i,
        /\b(?:verify|confirm)\s+(?:your|your\s+)?(?:identity|account)\b/i,
        /\b(?:identity|account)\s+(?:verification|verification\s+step)\b/i,
        /\b(?:send|send you)\s+(?:a\s+)?(?:code|verification\s+code|security\s+code)\b/i,
        /\b(?:enter|provide|give)\s+(?:the\s+)?(?:code|verification\s+code)\b/i
    ];
    return securityPatterns.some(pattern => pattern.test(speechResult));
}
/**
 * Get verification method preference
 */
function getVerificationPreference(userData) {
    const preferences = [];
    if (userData.zipCode) {
        preferences.push('ZIP code');
    }
    if (userData.accountPhoneNumber || userData.phone) {
        preferences.push('phone number');
    }
    if (userData.email) {
        preferences.push('email');
    }
    return preferences.length > 0
        ? `Can we verify using my ${preferences[0]} instead?`
        : 'I prefer not to receive texts, can we verify another way?';
}
//# sourceMappingURL=securityDetector.js.map