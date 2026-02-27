# Automated Live Call Evaluation System

## Goal

Jest-based integration tests that dial real phone numbers and validate IVR navigation flows.

## Architecture

### Test Cases

Defined in `packages/backend/src/services/liveCallTestCases.ts` with `LiveCallTestCase` interface.

### Jest Test File

`packages/backend/src/services/__tests__/liveCallEval.test.ts`

- Uses `twilioService.initiateCall()` to make real calls
- Polls `twilioService.getCallStatus()` until terminal status
- Reads DTMF presses and transfer events from `callHistoryService.getCall()`
- Asserts with Jest `expect()` (maxDTMFPresses, shouldReachHuman, duration, expectedDigits)
- Per-test timeout based on `maxDurationSeconds`

### Running

```bash
# Full suite
npx jest liveCallEval

# Quick (single test case)
LIVE_EVAL_QUICK=1 npx jest liveCallEval
```

Required env vars: `TWIML_URL`/`BASE_URL`, `TWILIO_PHONE_NUMBER`, `TRANSFER_PHONE_NUMBER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `MONGODB_URI`.
