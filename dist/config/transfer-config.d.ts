/**
 * Transfer-Only Configuration
 * Simplified configuration for transfer-only phone navigation
 */
export interface AISettings {
    model: string;
    maxTokens: number;
    temperature: number;
    voice?: string;
    language?: string;
}
export interface TransferConfig {
    transferNumber: string;
    userPhone: string;
    userEmail: string;
    customInstructions?: string;
    callPurpose?: string;
    aiSettings: AISettings;
}
export interface UserInput {
    transferNumber?: string;
    userPhone?: string;
    userEmail?: string;
    customInstructions?: string;
    callPurpose?: string;
    aiSettings?: Partial<AISettings>;
}
declare const transferConfig: {
    /**
     * Default transfer configuration
     */
    defaults: {
        transferNumber: string;
        userPhone: string;
        userEmail: string;
        aiSettings: AISettings;
    };
    /**
     * Create transfer configuration from user input
     */
    createConfig(userInput?: UserInput): TransferConfig;
};
export default transferConfig;
//# sourceMappingURL=transfer-config.d.ts.map