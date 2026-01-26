"use strict";
/**
 * Termination Condition Detector
 * Detects when call should be terminated (closed, voicemail, dead end)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClosedNoMenu = isClosedNoMenu;
exports.isVoicemailRecording = isVoicemailRecording;
exports.isDeadEnd = isDeadEnd;
exports.shouldTerminate = shouldTerminate;
/**
 * Check if speech indicates the business is closed with no menu options
 */
function isClosedNoMenu(speechResult) {
    if (!speechResult || typeof speechResult !== 'string') {
        return false;
    }
    const closedPatterns = [
        /\b(?:we\s+are|we're)\s+(?:currently\s+)?closed\b/i,
        /\b(?:our\s+)?(?:business|store|office|hours?)\s+(?:are|is)\s+/i,
        /\bclosed\s+(?:now|today|at\s+this\s+time)\b/i,
        /\b(?:we\s+)?(?:will\s+be|are)\s+closed\b/i
    ];
    const hasClosed = closedPatterns.some(pattern => pattern.test(speechResult));
    const hasMenuOptions = /\b(?:press|enter|select|choose|dial|push)\s+\d+/i.test(speechResult);
    const hasLeaveMessage = /\b(?:leave|press)\s+(?:a\s+)?(?:message|voicemail)\b/i.test(speechResult);
    return hasClosed && !hasMenuOptions && !hasLeaveMessage;
}
/**
 * Check if speech indicates voicemail recording has started
 */
function isVoicemailRecording(speechResult) {
    if (!speechResult || typeof speechResult !== 'string') {
        return false;
    }
    const voicemailPatterns = [
        /\b(?:please\s+)?leave\s+(?:a\s+)?(?:message|voicemail)\s+(?:after\s+|at\s+)?(?:the\s+)?(?:beep|tone)\b/i,
        /\b(?:after\s+|at\s+)?(?:the\s+)?(?:beep|tone)\s+(?:please\s+)?(?:leave|record)\s+(?:your\s+)?(?:message|voicemail)\b/i,
        /\b(?:recording|record)\s+(?:your\s+)?(?:message|voicemail)\b/i,
        /\b(?:message|voicemail)\s+(?:box|recording)\b/i,
        /\bleave\s+(?:a\s+)?(?:message|voicemail)\s+at\s+(?:the\s+)?(?:beep|tone)\b/i
    ];
    return voicemailPatterns.some(pattern => pattern.test(speechResult));
}
/**
 * Check if call has reached a dead end (silence after closed announcement)
 */
function isDeadEnd(speechResult, previousSpeech = '', silenceDuration = 0) {
    const wasClosed = isClosedNoMenu(previousSpeech);
    const isSilent = !speechResult || speechResult.trim().length === 0;
    return wasClosed && isSilent && silenceDuration > 10000;
}
/**
 * Check if any termination condition is met
 */
function shouldTerminate(speechResult, previousSpeech = '', silenceDuration = 0) {
    if (isVoicemailRecording(speechResult)) {
        return {
            shouldTerminate: true,
            reason: 'voicemail',
            message: 'Voicemail recording detected - ending call'
        };
    }
    if (isClosedNoMenu(speechResult)) {
        return {
            shouldTerminate: true,
            reason: 'closed_no_menu',
            message: 'Business is closed with no menu options - ending call'
        };
    }
    if (isDeadEnd(speechResult, previousSpeech, silenceDuration)) {
        return {
            shouldTerminate: true,
            reason: 'dead_end',
            message: 'Dead end reached after closed announcement - ending call'
        };
    }
    return {
        shouldTerminate: false,
        reason: null,
        message: null
    };
}
//# sourceMappingURL=terminationDetector.js.map