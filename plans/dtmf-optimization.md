# DTMF Response Time Optimization

## Issues to Fix

1. Sequential AI calls (6 sequential calls per speech segment)
2. Extra incomplete speech check before main processing
3. Fixed 2-second delay before DTMF
4. 15-second speech timeout too long
5. No parallel execution

## Changes

### 1. voiceProcessingService.ts - Parallelize AI calls

- Run detectTermination, detectTransferRequest, detectIVRMenu in parallel
- Only run extractMenuOptions if IVR detected
- Only run detectLoop if previousMenus exist
- Use Promise.all for parallel execution

### 2. twimlHelpers.ts - Reduce speech timeout

- Change DEFAULT_SPEECH_TIMEOUT from 15 to 6 seconds

### 3. speechProcessingService.ts - Reduce DTMF delay

- Change 2-second delay to 0.5 seconds
- Remove response.pause before DTMF

### 4. aiDetectionService.ts - Use faster model

- Use gpt-4o-mini for detection tasks (IVR, menu extraction, loop, termination)
- Keep gpt-4o only for complex DTMF decision
