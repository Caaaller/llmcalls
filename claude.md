# Claude/Agent Coding Standards

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

