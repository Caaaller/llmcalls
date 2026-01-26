/**
 * Transfer Detection Utilities
 * Detects when a call should be transferred based on speech patterns
 */
/**
 * Check if speech indicates a transfer request
 */
export declare function wantsTransfer(speechResult: string | null | undefined): boolean;
/**
 * Check if speech is incomplete (ends mid-sentence)
 */
export declare function isIncompleteSpeech(speechResult: string | null | undefined): boolean;
//# sourceMappingURL=transferDetector.d.ts.map