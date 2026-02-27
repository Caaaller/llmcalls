# Automated Live Call Evaluation System

## Goal

Create automated tests that dial real phone numbers and validate IVR navigation flows.

## Architecture

### 1. Test Case Definition

```typescript
interface LiveCallTestCase {
  id: string;
  name: string;
  phoneNumber: string; // Number to call
  callPurpose: string; // e.g., "speak with a representative"
  customInstructions?: string;
  expectedOutcome: {
    shouldReachHuman: boolean;
    maxDTMFPresses?: number;
    expectedDigits?: string[]; // Expected DTMF sequence
    maxDurationSeconds?: number;
  };
}
```

### 2. Test Runner Service

- `initiateCall()` - Start the call via Twilio
- `monitorCall()` - Poll call status, track events
- `collectResults()` - Gather DTMF presses, duration, outcome
- `terminateCall()` - End the call if timeout

### 3. Evaluation API

- POST `/evals/run` - Run all test cases
- GET `/evals/results` - Get past results

## Implementation Plan

1. Create `liveCallEvalService.ts` with test runner logic
2. Create test case definitions for common scenarios
3. Add API routes for running evals
4. Add frontend UI to trigger evals and view results
