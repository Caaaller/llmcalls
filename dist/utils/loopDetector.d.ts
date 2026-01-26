/**
 * Loop Detection Utility
 * Detects when IVR menus are repeating/looping
 */
import { MenuOption } from './ivrDetector';
export interface LoopResult {
    isLoop: boolean;
    repeatedOption?: MenuOption;
    firstSeenAt?: number;
    message?: string;
}
export declare class LoopDetector {
    private recentOptions;
    private maxHistory;
    /**
     * Add a menu option to history
     */
    addOption(option: MenuOption): void;
    /**
     * Check if current options contain a loop
     */
    detectLoop(currentOptions: MenuOption[]): LoopResult;
    /**
     * Reset history
     */
    reset(): void;
    /**
     * Check if speech contains a repeating pattern
     */
    static detectLoopInSpeech(speechResult: string, previousSpeech?: string): LoopResult;
}
//# sourceMappingURL=loopDetector.d.ts.map