import 'dotenv/config';
/**
 * Initiates a phone call using Twilio
 */
declare function initiateCall(to: string, from: string, url: string): Promise<import("twilio/lib/rest/api/v2010/account/call").CallInstance>;
/**
 * Fetches the current status and details of a call
 */
declare function getCallStatus(callSid: string): Promise<import("twilio/lib/rest/api/v2010/account/call").CallInstance>;
/**
 * Monitors a call and checks its status periodically
 */
declare function monitorCall(callSid: string, intervalMs?: number, maxChecks?: number): Promise<import("twilio/lib/rest/api/v2010/account/call").CallInstance>;
export { initiateCall, getCallStatus, monitorCall };
//# sourceMappingURL=index.d.ts.map