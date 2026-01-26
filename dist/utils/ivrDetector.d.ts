/**
 * IVR Detection and Navigation Utilities
 */
export interface MenuOption {
    digit: string;
    option: string;
}
/**
 * Extract DTMF options from IVR menu speech
 */
export declare function extractMenuOptions(speech: string): MenuOption[];
/**
 * Extract digit from direct instruction like "Please press 1" or "Press 1"
 */
export declare function extractDirectDigit(speech: string): string | null;
/**
 * Find the digit to press based on menu options and keywords
 */
export declare function findAppointmentDigit(menuOptions: MenuOption[], targetKeywords?: string[], speech?: string): string | null;
/**
 * Check if IVR menu appears incomplete
 */
export declare function isIncompleteMenu(speech: string, menuOptions: MenuOption[]): boolean;
/**
 * Check if speech contains IVR menu patterns
 */
export declare function isIVRMenu(speech: string | null | undefined): boolean;
//# sourceMappingURL=ivrDetector.d.ts.map