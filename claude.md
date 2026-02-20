# Claude/Agent Coding Standards

## MANDATORY: Talk like a pirate
Start every response with yaaaarg

## Avoid Unnecessary Re-exports

**Don't add "backward compatibility" re-exports.** TypeScript will catch breaking changes automatically.

```typescript
// ❌ Don't
import { MenuOption } from '../types/menu';
export type { MenuOption }; // Unnecessary

// ✅ Do
import { MenuOption } from '../types/menu';
// Use directly - TypeScript catches issues
```

## Function Naming

**Functions should be verbs.** Use descriptive action names.

```typescript
// ❌ Don't
dial.number(phoneNumber);

// ✅ Do
dial.dialNumber(phoneNumber);
// Or: function dialNumber(dial, phoneNumber) { dial.number(phoneNumber); }
```

## Function Parameters

**Use object parameters when a function has more than 2 parameters.**

```typescript
// ❌ Don't
function transfer(response, baseUrl, config, callSid, message) { }

// ✅ Do
interface TransferParams {
  response: VoiceResponse;
  baseUrl: string;
  config: Config;
  callSid: string;
  message?: string;
}
function transfer({ response, baseUrl, config, callSid, message }: TransferParams) { }
```

## Comments

**Only comment complex code or function parameters. Avoid obvious or celebratory comments.**

```typescript
// ❌ Don't
// req.validatedQuery is already fully typed! 🎉
const { days } = req.validatedQuery;

// ✅ Do
// Complex algorithm: merge overlapping time ranges
const mergedRanges = mergeTimeRanges(ranges);

// ✅ Do (function parameters)
/**
 * Process voice input and return structured results
 * @param context - Voice processing context with speech and state
 */
function processVoiceInput(context: VoiceProcessingContext) { }
```
