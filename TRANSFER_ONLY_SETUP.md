# Transfer-Only Phone Navigator Setup

## Overview

The system has been refactored to focus **solely on navigating IVR menus and transferring calls** to live representatives. Appointment booking and other complex interactions have been removed.

## Key Features

### 1. **IVR Navigation**
- Automatically detects IVR menus
- Uses DTMF tones to navigate
- Detects loops and acts immediately
- Waits for silence OR detects loops before pressing keys

### 2. **Loop Detection**
- Detects when IVR menus repeat
- Acts immediately when loops are detected (doesn't wait for silence)
- Prevents infinite waiting

### 3. **Human Confirmation**
- Confirms human before transferring: "Am I speaking with a real person or is this the automated system?"
- Only transfers after explicit human confirmation

### 4. **Callback Handling**
- Detects callback options
- Requests callback with transfer number
- Ends call after callback is confirmed (doesn't transfer)

### 5. **Termination Conditions**
- Ends call if business is closed (no menu options)
- Ends call if voicemail recording starts
- Ends call if dead end reached (silence after closed announcement)

## Configuration

### Environment Variables

Add to `.env`:

```env
# Transfer Configuration
TRANSFER_PHONE_NUMBER=720-584-6358  # Number to transfer calls to
USER_PHONE_NUMBER=720-584-6358      # User's phone number (for callbacks)
USER_EMAIL=oliverullman@gmail.com   # User's email
```

### Transfer Configuration

The system uses `config/transfer-config.js` for default settings. You can override these when initiating calls.

## Usage

### Basic Call Initiation

```bash
node index.js "" transfer-only
```

### With Custom Instructions

Update `index.js` or create a new script to pass custom instructions:

```javascript
const transferConfig = require('./config/transfer-config');
const config = transferConfig.createConfig({
  transferNumber: '720-584-6358',
  callPurpose: 'check order status',
  customInstructions: 'I need to check the status of my recent order'
});
```

## New Files Created

1. **`prompts/transfer-prompt.js`** - Main transfer-only prompt template
2. **`config/transfer-config.js`** - Transfer configuration management
3. **`utils/loopDetector.js`** - Loop detection utility
4. **`utils/terminationDetector.js`** - Termination condition detection

## Updated Logic Flow

1. **Call Starts** → Listen for IVR menu
2. **IVR Detected** → Extract options
3. **Loop Check** → If loop detected, press key immediately
4. **Silence Check** → If 2+ seconds silence + menu context, press key
5. **Human Detection** → Confirm human before transferring
6. **Transfer** → Transfer to configured number
7. **Termination** → End call if closed/voicemail/dead end

## Key Differences from Previous System

### Removed:
- ❌ Appointment booking scenarios
- ❌ Complex user data (names, addresses, etc.)
- ❌ Scenario-specific prompts
- ❌ Multiple scenario types

### Added:
- ✅ Loop detection
- ✅ Human confirmation before transfer
- ✅ Callback handling
- ✅ Termination conditions
- ✅ Simplified transfer-only focus

## Next Steps

1. **Update `routes/voiceRoutes.js`** to use the new transfer prompt
2. **Update `services/aiService.js`** to support transfer prompt
3. **Test loop detection** with real IVR systems
4. **Test human confirmation** flow
5. **Test termination conditions**

## Testing

Test with various IVR systems:
- Systems that loop (like Costco)
- Systems with long menus
- Systems with callback options
- Closed businesses
- Voicemail systems

