/**
 * AI Service
 * Handles OpenAI interactions
 */
export interface ConversationEntry {
    type: 'user' | 'ai' | 'system';
    text: string;
    timestamp?: Date;
}
export interface TransferConfig {
    transferNumber: string;
    callPurpose?: string;
    customInstructions?: string;
    aiSettings?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
    };
}
export interface Scenario {
    promptTemplate?: string;
    userData?: any;
    aiSettings: {
        model: string;
        maxTokens: number;
        temperature: number;
    };
}
export interface PromptResult {
    system: string;
    user?: string;
}
declare class AIService {
    private client;
    constructor();
    /**
     * Generate AI response based on scenario or transfer config
     */
    generateResponse(scenarioOrConfig: TransferConfig | Scenario, speechResult: string, isFirstCall: boolean, conversationHistory?: ConversationEntry[]): Promise<string>;
    /**
     * Build conversation context for transfer-only calls
     */
    buildTransferContext(speechResult: string, isFirstCall: boolean, conversationHistory?: ConversationEntry[]): string;
}
declare const aiService: AIService;
export default aiService;
//# sourceMappingURL=aiService.d.ts.map