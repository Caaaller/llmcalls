# Claude/Agent Coding Standards

## Avoid Unnecessary Re-exports

**Do not add "backward compatibility" re-exports unless there's a specific, documented reason.**

### Why This Is Problematic
- **TypeScript will catch breaking changes**: If a type is removed or changed, TypeScript will automatically detect violations at compile time
- **Adds maintenance burden**: Unnecessary re-exports create confusion about where types actually live
- **Violates single source of truth**: Types should be imported from their original location

### Example

**Don't do this:**
```typescript
import { MenuOption } from '../types/menu';

// Re-export for backward compatibility
export type { MenuOption };
```

**Do this instead:**
```typescript
import { MenuOption } from '../types/menu';

// Use MenuOption directly - TypeScript will catch any issues
export interface CallEvent {
  menuOptions?: MenuOption[];
}
```

If there are actual breaking changes that need backward compatibility, handle them explicitly with deprecation warnings or migration paths, not silent re-exports.

## Function Naming

**Functions should be verbs that describe the action they perform.**

### Benefits
- **Clear intent**: Function names immediately communicate what action is being performed
- **Better readability**: Code reads more naturally (e.g., `dial.dialNumber()` instead of `dial.number()`)
- **Consistent API**: All functions follow the same naming pattern

### Example

**Before:**
```typescript
dial.number(config.transferNumber);
```

**After:**
```typescript
dial.dialNumber(config.transferNumber);
// Or create a helper function:
function dialNumber(dial: twilio.twiml.VoiceResponse.Dial, phoneNumber: string): void {
  dial.number(phoneNumber);
}
```

## Function Parameters

**When a function has more than 2 parameters, use object parameters instead of positional parameters.**

### Benefits
- **Improved readability**: Each parameter gets a label at the call site
- **Order independence**: Parameters can be passed in any order
- **Easier maintenance**: Adding/removing parameters doesn't break existing calls
- **Better IDE support**: Autocomplete shows parameter names

### Example

**Before:**
```typescript
function initiateTransfer(
  response: twilio.twiml.VoiceResponse,
  baseUrl: string,
  config: TransferConfigType,
  callSid: string,
  message: string = 'Hold on, please.'
): twilio.twiml.VoiceResponse {
  // ...
}
```

**After:**
```typescript
interface InitiateTransferParams {
  response: twilio.twiml.VoiceResponse;
  baseUrl: string;
  config: TransferConfigType;
  callSid: string;
  message?: string;
}

function initiateTransfer({
  response,
  baseUrl,
  config,
  callSid,
  message = 'Hold on, please.',
}: InitiateTransferParams): twilio.twiml.VoiceResponse {
  // ...
}
```

### Usage
```typescript
// Clear and readable - order doesn't matter
initiateTransfer({
  callSid,
  config,
  baseUrl,
  response,
  message: 'Thank you. Hold on, please.'
});
```
