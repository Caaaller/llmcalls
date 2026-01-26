/**
 * Confirmation Question Detection
 * Detects yes/no confirmation questions that need simple affirmative/negative responses
 */
/**
 * Check if speech contains a confirmation question (yes/no question)
 */
export declare function isConfirmationQuestion(speechResult: string | null | undefined): boolean;
/**
 * Extract the value being confirmed (if any)
 */
export declare function extractConfirmationValue(speechResult: string | null | undefined): string | null;
/**
 * Determine if this is a positive confirmation (should say "yes")
 */
export declare function requiresPositiveConfirmation(speechResult: string | null | undefined): boolean;
//# sourceMappingURL=confirmationDetector.d.ts.map