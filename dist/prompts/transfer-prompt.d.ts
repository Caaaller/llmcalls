/**
 * Transfer-Only Phone Navigator Prompt
 * Main prompt for navigating IVR systems and transferring to live representatives
 */
export interface PromptResult {
    system: string;
    user?: string;
}
export interface TransferPromptConfig {
    transferNumber?: string;
    userPhone?: string;
    userEmail?: string;
    customInstructions?: string;
    callPurpose?: string;
}
export declare const transferPrompt: {
    /**
     * Main transfer-only prompt template
     */
    'transfer-only': (config?: TransferPromptConfig, conversationContext?: string, _isFirstCall?: boolean) => PromptResult;
};
//# sourceMappingURL=transfer-prompt.d.ts.map