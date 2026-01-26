/**
 * Termination Condition Detector
 * Detects when call should be terminated (closed, voicemail, dead end)
 */
export interface TerminationResult {
    shouldTerminate: boolean;
    reason: 'voicemail' | 'closed_no_menu' | 'dead_end' | null;
    message: string | null;
}
/**
 * Check if speech indicates the business is closed with no menu options
 */
export declare function isClosedNoMenu(speechResult: string | null | undefined): boolean;
/**
 * Check if speech indicates voicemail recording has started
 */
export declare function isVoicemailRecording(speechResult: string | null | undefined): boolean;
/**
 * Check if call has reached a dead end (silence after closed announcement)
 */
export declare function isDeadEnd(speechResult: string | null | undefined, previousSpeech?: string, silenceDuration?: number): boolean;
/**
 * Check if any termination condition is met
 */
export declare function shouldTerminate(speechResult: string | null | undefined, previousSpeech?: string, silenceDuration?: number): TerminationResult;
//# sourceMappingURL=terminationDetector.d.ts.map