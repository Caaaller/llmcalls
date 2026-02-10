# Cleanup Checklist: Remove Static Functions

## ✅ Completed
- [x] All runtime code uses AI
- [x] `promptEvaluationService.ts` uses AI
- [x] All detection functions migrated to AI

## 🗑️ Can Be Deleted (Static Function Tests)

These test files test functions that are no longer used in production:

```bash
# Delete these test files:
rm src/utils/__tests__/ivrDetector.test.ts
rm src/utils/__tests__/transferDetector.test.ts
rm src/utils/__tests__/terminationDetector.test.ts
rm src/utils/__tests__/loopDetector.test.ts
rm src/utils/__tests__/transferDetection.test.ts
rm src/utils/__tests__/menuWaiting.test.ts
```

**Reason:** These test static functions that are never called in production. The AI functions are tested by `promptEvaluationService.ts`.

## ⚠️ Can Be Deleted (Static Function Files)

These files contain static functions that are no longer used:

```bash
# Option 1: Delete entirely (after moving MenuOption type)
rm src/utils/ivrDetector.ts
rm src/utils/transferDetector.ts
rm src/utils/terminationDetector.ts
rm src/utils/loopDetector.ts
rm src/utils/detectionPatterns.ts
```

**Note:** `MenuOption` type is still used. Options:
1. Move `MenuOption` to `src/types/menu.ts` then delete `ivrDetector.ts`
2. Keep `ivrDetector.ts` just for the type (minimal file)

## 🧹 Cleanup Imports

After deleting files, remove unused imports from:
- `src/routes/voiceRoutes.ts` - Lines 12-15 (static function imports)
- `src/services/promptEvaluationService.ts` - Already cleaned ✅

## 📝 New Test Suite

Your new test suite is:
- **`src/services/promptEvaluationService.ts`** - Tests all AI functions
- Run with: `npm run eval:prompts`
- Tests real scenarios with actual AI calls
- More valuable than static function tests

## Summary

**Before:** 6 test files testing unused static functions  
**After:** 1 evaluation service testing AI functions with real scenarios

**Result:** Cleaner codebase, tests that match production behavior

