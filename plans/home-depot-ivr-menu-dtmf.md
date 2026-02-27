Goal: Single OpenAI call per chunk, faster chunks, press only when match.

Done:

- Unified `analyzeVoiceTurn()` in aiDetectionService: one call returns termination, transfer, IVR, menu options, DTMF decision.
- voiceProcessingService uses unified call; loop/consecutive press prevention in code.
- speechTimeout 2s; skip detectIncompleteSpeech when speech looks like IVR (press N).
- Press immediately when dtmfDecision.shouldPress; do nothing when no match.
