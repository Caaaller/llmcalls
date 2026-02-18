# Claude/Agent Coding Standards

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
