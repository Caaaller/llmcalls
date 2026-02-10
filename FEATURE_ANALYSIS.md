
## Overview
This document categorizes all major features in the call handling system, identifying which use AI (OpenAI GPT-4o) and which use static rule-based functions (regex patterns, string matching, etc.). This helps identify areas that may be brittle and could benefit from AI-powered solutions.

---

## Feature Categories

### 1. IVR MENU DETECTION & PROCESSING

#### 1.1 IVR Menu Detection (`isIVRMenu`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/ivrDetector.ts`
**Implementation:** Regex patterns
- `/(press|for|to)\s*\d/` - Matches "press X", "for X", "to X"
- `/\d\s+(for|to)\s+/` - Matches "X for Y", "X to Y"
- `/main menu|options are|following options/` - Matches menu keywords

**Brittleness Concerns:**
- Only matches specific patterns. Won't detect menus phrased differently (e.g., "Select option 1", "Choose 1", "Dial 1")
- Relies on exact keyword matching
- May miss non-standard menu formats

**Recommendation:** Consider AI-powered detection for better generalization

---

#### 1.2 Menu Option Extraction (`extractMenuOptions`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/ivrDetector.ts`
**Implementation:** Multiple regex patterns to extract digit-option pairs

**Patterns Handled:**
1. **Pattern 1:** `"for X, press Y"` or `"to X, press Y"` (reverse pattern with comma)
2. **Pattern 1b:** `"to X press Y"` or `"for X press Y"` (reverse pattern without comma)
3. **Pattern 2:** `"Press X, to Y"` or `"Press X, for Y"` (forward pattern with comma)
4. **Pattern 3:** `"Press X for Y"` (forward pattern without comma)
5. **Pattern 4:** `"X for Y"` (simple pattern without "press")

**Brittleness Concerns:**
- **Very brittle** - Only handles these specific patterns
- Misses variations like:
  - "Select 1 for sales"
  - "Choose option 1"
  - "Dial 1"
  - "Press the number 1"
  - "Option 1 is for sales"
  - "To reach sales, dial 1"
- Complex logic to avoid false matches (e.g., checking if reverse pattern is part of forward pattern)
- Hard to maintain as new patterns emerge

**Example Brittle Code:**
```typescript
const reversePattern = /(?:for|to)\s+([^,]+?),\s*press\s*(\d+)/gi;
// This only matches "for X, press Y" - misses many variations
```

**Recommendation:** **HIGH PRIORITY** - This is a critical brittle area. Consider AI-powered extraction.

---

#### 1.3 Incomplete Menu Detection (`isIncompleteMenu`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/ivrDetector.ts`
**Implementation:** Compares count of regex matches vs extracted options

**Logic:**
- Counts `press\s*\d` patterns in speech
- Counts `\d\s+for\s+[^,.]+` patterns
- Compares total patterns vs extracted menu options
- If patterns > options, considers menu incomplete

**Brittleness Concerns:**
- Relies on regex pattern counting
- May incorrectly flag complete menus if extraction fails
- Doesn't understand semantic completeness

**Recommendation:** Consider AI-powered completeness check

---

#### 1.4 Menu Continuation Detection
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/routes/voiceRoutes.ts` (lines 321-324)
**Implementation:** Regex patterns

```typescript
const isContinuingMenu =
  ivrDetector.isIVRMenu(speechResult) ||
  /\b(for|press|select|choose)\s*\d+/i.test(speechResult) ||
  /\b\d+\s+(for|to|press)/i.test(speechResult);
```

**Brittleness Concerns:**
- Only checks for specific keywords
- May miss continuation phrases like "also", "additionally", "next option"

**Recommendation:** Could benefit from AI understanding

---

### 2. DTMF DECISION MAKING

#### 2.1 DTMF Digit Selection (Primary)
**Type:** ✅ **AI-POWERED**
**Location:** `src/services/aiDTMFService.ts`
**Service:** `understandCallPurposeAndPressDTMF()`
**Model:** GPT-4o

**How it works:**
- Takes call purpose, menu options, and speech
- Uses AI to semantically match call purpose to menu options
- Returns which digit to press with reasoning

**Strengths:**
- Handles semantic matching (e.g., "customer service" matches "support")
- Understands context and intent
- Can handle variations in menu option wording

**Fallback:** If AI doesn't find a match, falls back to static function (see 2.2)

---

#### 2.2 DTMF Digit Selection (Fallback)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/routes/voiceRoutes.ts` (lines 474-531)
**Implementation:** String matching with `.includes()`

**Fallback Logic (in order):**
1. **Representative Option:** Searches for keywords: `'representative'`, `'agent'`, `'operator'`, `'customer service'`, `'speak to'`
2. **Support Option:** Searches for: `'technical support'`, `'support'`, `'help'`, `'assistance'`
3. **Other Option:** Searches for: `'other'`, `'all other'`, `'additional'`

**Brittleness Concerns:**
- **Very brittle** - Only matches exact substrings
- Won't match synonyms or variations:
  - "customer care" (not in list)
  - "live agent" (not in list)
  - "human operator" (not in list)
- Case-sensitive matching (though uses `.toLowerCase()`)
- Hard-coded keyword lists

**Example Brittle Code:**
```typescript
const repOption = allMenuOptions.find(
  (opt) =>
    opt.option.includes('representative') ||
    opt.option.includes('agent') ||
    // ... hard-coded list
);
```

**Recommendation:** This fallback is brittle. Consider improving AI prompt or removing fallback.

---

### 3. LOOP DETECTION

#### 3.1 Loop Detection (`detectLoop`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/loopDetector.ts`
**Implementation:** Exact string matching of menu option sequences

**How it works:**
- Tracks seen menu option sequences as strings: `"1:sales|2:support"`
- Compares new menu against seen sequences
- If exact match found, detects loop

**Brittleness Concerns:**
- **Very brittle** - Only detects exact repetition
- Won't detect semantic loops (same options, different wording)
- Won't detect partial loops (some options repeat)
- Example: "Press 1 for sales" vs "Press 1 for our sales department" won't match

**Example Brittle Code:**
```typescript
const optionKey = options.map(o => `${o.digit}:${o.option}`).join('|');
if (seenOptions.includes(optionKey)) {
  return { isLoop: true };
}
```

**Recommendation:** **HIGH PRIORITY** - Consider AI-powered semantic loop detection

---

#### 3.2 Loop Action Selection
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/routes/voiceRoutes.ts` (lines 420-427)
**Implementation:** String matching with `.includes()`

**Logic:**
- When loop detected, finds "best option" using hard-coded keywords
- Searches for: `'representative'`, `'agent'`, `'other'`, `'operator'`
- Falls back to first option if none match

**Brittleness Concerns:**
- Same brittleness as DTMF fallback (see 2.2)
- Hard-coded keyword matching

**Recommendation:** Use AI to select best option when loop detected

---

### 4. TRANSFER DETECTION

#### 4.1 Transfer Request Detection (`wantsTransfer`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/transferDetector.ts`
**Implementation:** Pattern matching against `TRANSFER_PATTERNS` array

**Patterns Checked:**
- Explicit transfer confirmations (hard-coded list)
- `TRANSFER_PATTERNS` array (62 patterns)
- Excludes IVR menu contexts using regex

**Brittleness Concerns:**
- **Brittle** - Relies on hard-coded pattern list
- May miss variations:
  - "Can you connect me?" (not in list)
  - "I'd like to talk to someone" (not in list)
  - "Put me through" (not in list)
- Complex logic to avoid false positives from IVR menus

**Example Brittle Code:**
```typescript
const explicitTransferPatterns = [
  "i'm transferring you",
  'i am transferring you',
  // ... hard-coded list
];
```

**Recommendation:** Consider AI-powered transfer detection for better generalization

---

#### 4.2 Human Confirmation Detection
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/routes/voiceRoutes.ts` (lines 581-584)
**Implementation:** Regex pattern

```typescript
const isHumanConfirmation =
  /(?:yes|yeah|correct|right|real person|human|yes i am|yes this is|yes you are|talking to a real person|speaking with a real person)/i.test(speechResult);
```

**Brittleness Concerns:**
- **Very brittle** - Only matches specific phrases
- Misses variations:
  - "That's correct"
  - "I am a person"
  - "Yes, you're speaking with a human"
  - "Affirmative"
  - "Correct, I'm real"

**Recommendation:** **HIGH PRIORITY** - This is critical for transfers. Consider AI-powered confirmation.

---

### 5. TERMINATION DETECTION

#### 5.1 Voicemail Detection (`isVoicemailRecording`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/terminationDetector.ts`
**Implementation:** Pattern matching against `VOICEMAIL_PATTERNS` array

**Patterns:**
- `'please leave a message after the beep'`
- `'please leave your message after the tone'`
- `'record your message'`
- `'at the tone'`
- `'voicemail'`
- `'leave a message'`

**Brittleness Concerns:**
- **Brittle** - Hard-coded pattern list
- May miss variations:
  - "Please record your message now"
  - "After the beep, leave your message"
  - "You've reached voicemail"

**Recommendation:** Consider AI-powered detection

---

#### 5.2 Business Closed Detection (`isClosed`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/terminationDetector.ts`
**Implementation:** Pattern matching against `CLOSED_PATTERNS` array

**Patterns:**
- `'we are currently closed'`
- `'our office is currently closed'`
- `'outside of our normal business hours'`
- `'we are closed'`
- `'currently closed'`
- `'please call back during business hours'`

**Brittleness Concerns:**
- **Brittle** - Hard-coded pattern list
- May miss variations:
  - "We're closed right now"
  - "Office hours are 9-5"
  - "Closed for the day"

**Recommendation:** Consider AI-powered detection

---

#### 5.3 Dead End Detection (`isDeadEnd`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/terminationDetector.ts`
**Implementation:** Logic combining closed detection + silence

**Logic:**
- Checks if previous speech indicated closed
- Checks if current speech is empty
- Checks if silence duration >= 5 seconds

**Brittleness Concerns:**
- Relies on closed detection (brittle - see 5.2)
- Fixed 5-second threshold may not work for all systems

**Recommendation:** Could benefit from AI understanding context

---

### 6. CONVERSATION HANDLING

#### 6.1 AI Response Generation
**Type:** ✅ **AI-POWERED**
**Location:** `src/services/aiService.ts`
**Service:** `generateResponse()`
**Model:** GPT-4o

**How it works:**
- Uses comprehensive prompt (`transfer-prompt.ts`)
- Handles conversation context
- Decides when to speak vs remain silent
- Handles custom instructions and call purpose

**Strengths:**
- Context-aware responses
- Handles variations naturally
- Can adapt to different scenarios

---

#### 6.2 Incomplete Speech Detection (`isIncompleteSpeech`)
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/utils/transferDetector.ts`
**Implementation:** Simple heuristics

**Logic:**
- Checks if speech ends with punctuation
- Checks if speech is short (< 5 words) without punctuation
- If both true, considers incomplete

**Brittleness Concerns:**
- Very simple heuristic
- May incorrectly flag complete short sentences
- Doesn't understand semantic completeness

**Recommendation:** Low priority, but could use AI

---

### 7. MENU WAITING & STATE MANAGEMENT

#### 7.1 Menu Waiting Logic
**Type:** ⚠️ **STATIC FUNCTION (Rule-Based)**
**Location:** `src/routes/voiceRoutes.ts` (lines 319-337, 619-642)
**Implementation:** State flags + regex checks

**Logic:**
- Sets `awaitingCompleteMenu` flag when incomplete menu detected
- Uses regex to check if speech continues menu
- Merges partial menu options

**Brittleness Concerns:**
- Relies on incomplete menu detection (brittle - see 1.3)
- Relies on continuation detection (brittle - see 1.4)

**Recommendation:** Depends on other brittle functions

---

## Summary Statistics

### AI-Powered Features: 2
1. ✅ DTMF Digit Selection (Primary) - `aiDTMFService.ts`
2. ✅ AI Response Generation - `aiService.ts`

### Static/Rule-Based Features: 13
1. ⚠️ IVR Menu Detection - `ivrDetector.isIVRMenu()`
2. ⚠️ Menu Option Extraction - `ivrDetector.extractMenuOptions()` ⚠️ **VERY BRITTLE**
3. ⚠️ Incomplete Menu Detection - `ivrDetector.isIncompleteMenu()`
4. ⚠️ Menu Continuation Detection - Regex in `voiceRoutes.ts`
5. ⚠️ DTMF Fallback Selection - String matching in `voiceRoutes.ts` ⚠️ **BRITTLE**
6. ⚠️ Loop Detection - `loopDetector.detectLoop()` ⚠️ **VERY BRITTLE**
7. ⚠️ Loop Action Selection - String matching in `voiceRoutes.ts`
8. ⚠️ Transfer Request Detection - `transferDetector.wantsTransfer()` ⚠️ **BRITTLE**
9. ⚠️ Human Confirmation Detection - Regex in `voiceRoutes.ts` ⚠️ **VERY BRITTLE**
10. ⚠️ Voicemail Detection - `terminationDetector.isVoicemailRecording()`
11. ⚠️ Business Closed Detection - `terminationDetector.isClosed()`
12. ⚠️ Dead End Detection - `terminationDetector.isDeadEnd()`
13. ⚠️ Incomplete Speech Detection - `transferDetector.isIncompleteSpeech()`

---

## Files Reference

### AI Services:
- `src/services/aiService.ts` - Main AI conversation handling
- `src/services/aiDTMFService.ts` - AI-powered DTMF decisions

### Static Function Utilities:
- `src/utils/ivrDetector.ts` - IVR menu detection and extraction
- `src/utils/transferDetector.ts` - Transfer request detection
- `src/utils/terminationDetector.ts` - Termination condition detection
- `src/utils/loopDetector.ts` - Loop detection
- `src/utils/detectionPatterns.ts` - Pattern constants


