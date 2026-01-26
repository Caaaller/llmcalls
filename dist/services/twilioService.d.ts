/**
 * Twilio Service
 * Handles Twilio API interactions
 */
export interface CallOptions {
    statusCallback?: string;
    [key: string]: any;
}
declare class TwilioService {
    private client;
    constructor();
    /**
     * Send DTMF digits
     */
    sendDTMF(callSid: string, digits: string): Promise<boolean>;
    /**
     * Initiate a call
     */
    initiateCall(to: string, from: string, url: string, options?: CallOptions): Promise<import("twilio/lib/rest/api/v2010/account/call").CallInstance>;
    /**
     * Get call status
     */
    getCallStatus(callSid: string): Promise<import("twilio/lib/rest/api/v2010/account/call").CallInstance>;
    /**
     * Generate Twilio Access Token for browser client
     */
    generateAccessToken(identity: string, _appName: string): string;
}
declare const twilioService: TwilioService;
export default twilioService;
//# sourceMappingURL=twilioService.d.ts.map