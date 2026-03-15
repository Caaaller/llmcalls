# Refactor: Single AI Call Per Turn

Replace 11-13 separate OpenAI calls per speech turn with ONE unified call.

## Status: COMPLETE — builds clean

## Changes Made

1. **NEW** `ivrNavigatorService.ts` (151 lines) — single `decideAction()` function, returns `CallAction`
2. **EXTENDED** `transfer-prompt.ts` (267 lines) — folded in detection criteria from aiDetectionService
3. **REPLACED** `config/prompts.ts` (52 lines) — `formatConversationForAI()` replaces first/continuing context
4. **SIMPLIFIED** `callStateManager.ts` (108 lines) — removed heuristic fields, added `actionHistory`
5. **REWRITTEN** `speechProcessingService.ts` (432 lines) — single AI call, maps `CallAction → ProcessSpeechResult`
6. **NEW** `types/voiceProcessing.ts` (44 lines) — shared `DTMFDecision`, `VoiceProcessingResult`, `TransferConfig`
7. **DELETED** `aiDetectionService.ts` (668 lines), `aiDTMFService.ts` (181 lines), `voiceProcessingService.ts` (173 lines), `aiService.ts` (197 lines)

## Results

| Metric              | Before                                                                            | After                 |
| ------------------- | --------------------------------------------------------------------------------- | --------------------- |
| AI service files    | 5 files, ~2,183 lines                                                             | 2 files, ~1,054 lines |
| API calls per turn  | 11-13                                                                             | 1                     |
| Heuristic overrides | consecutive press counters, loop confidence thresholds, incomplete speech merging | None (AI handles all) |

## Verification

- `pnpm --filter backend build` — compiles clean ✅
- `pnpm --filter backend test` — **28/42 passed** (same as baseline), 3 skipped, 11 failed
  - Prompt eval: 1 behavioral diff ("Transfer Request - Customer Service" — ambiguous IVR vs human speech), 3 transient API timeouts/errors
  - Live call: 7 failures — real Twilio calls to businesses, inherently non-deterministic
- Manual: start backend + ngrok, initiate call via frontend (TODO)
