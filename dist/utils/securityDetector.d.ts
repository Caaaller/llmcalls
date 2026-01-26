/**
 * Security Verification Detection
 * Detects security/verification requests that need special handling
 */
export interface UserData {
    zipCode?: string;
    accountPhoneNumber?: string;
    phone?: string;
    email?: string;
}
/**
 * Check if speech contains security verification requests
 */
export declare function isSecurityVerificationRequest(speechResult: string | null | undefined): boolean;
/**
 * Get verification method preference
 */
export declare function getVerificationPreference(userData: UserData): string;
//# sourceMappingURL=securityDetector.d.ts.map