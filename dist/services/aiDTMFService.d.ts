/**
 * AI DTMF Decision Service
 * Uses AI to understand call purpose and decide which DTMF digit to press
 */
import { MenuOption } from '../utils/ivrDetector';
export interface TransferConfig {
    callPurpose?: string;
    customInstructions?: string;
    description?: string;
}
export interface Scenario {
    description?: string;
}
export interface DTMFDecision {
    callPurpose: string;
    shouldPress: boolean;
    digit: string | null;
    matchedOption: string;
    reason: string;
}
declare class AIDTMFService {
    private client;
    constructor();
    /**
     * Understand the call purpose and match it to IVR menu options
     */
    understandCallPurposeAndPressDTMF(speech: string, configOrScenario: TransferConfig | Scenario, menuOptions?: MenuOption[]): Promise<DTMFDecision>;
    /**
     * Legacy method for backward compatibility
     */
    shouldPressDTMF(speech: string, scenario: Scenario): Promise<DTMFDecision>;
}
declare const aiDTMFService: AIDTMFService;
export default aiDTMFService;
//# sourceMappingURL=aiDTMFService.d.ts.map