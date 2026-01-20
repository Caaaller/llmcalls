# Twilio Voice Options Guide

## Available Voice Types

### 1. Basic Twilio Voices (Native `<Say>` verb)
These work out of the box but sound more robotic:
- `alice` - Female voice (default)
- `man` - Male voice  
- `woman` - Female voice

### 2. Neural Voices (More Human-Like)
For more natural-sounding voices, Twilio supports neural voices through **ConversationRelay** or by using provider-specific voices.

**Amazon Polly Neural Voices:**
- `Polly.Joanna` - Female, natural (US English)
- `Polly.Matthew` - Male, natural (US English)
- `Polly.Amy` - Female, natural (British English)
- `Polly.Brian` - Male, natural (British English)

**Google Neural Voices:**
- `Google.en-US-Neural2-A` - Female (US English)
- `Google.en-US-Neural2-C` - Female (US English)
- `Google.en-US-Neural2-D` - Male (US English)
- `Google.en-US-Neural2-E` - Female (US English)
- `Google.en-US-Neural2-F` - Female (US English)
- `Google.en-US-Neural2-G` - Female (US English)
- `Google.en-US-Neural2-H` - Female (US English)
- `Google.en-US-Neural2-I` - Male (US English)
- `Google.en-US-Neural2-J` - Male (US English)

**ElevenLabs Voices:**
- Requires ConversationRelay setup
- More advanced, very human-like

### 3. Generative Voices (Beta)
- `Google.Chirp3-HD` - Most natural, human-like
- `Amazon.Polly.Generative` - Natural with emotion

## How to Use

### Option 1: Update Scenario Config (Recommended)
Edit `config/scenarios.js` and change the `voice` field:

```javascript
aiSettings: {
  voice: 'Polly.Joanna', // Amazon Polly neural voice
  // or
  voice: 'Google.en-US-Neural2-A', // Google neural voice
  language: 'en-US'
}
```

### Option 2: Use ConversationRelay (Most Advanced)
For the most human-like voices, you'll need to use Twilio's ConversationRelay feature, which requires additional setup.

## Current Configuration

All scenarios are now configured to use neural voices:
- **doctor-appointment**: `Polly.Joanna` (Female, natural)
- **walmart-support**: `Polly.Joanna` (Female, natural)
- **insurance-claim**: `Polly.Matthew` (Male, natural - professional tone)
- **ebay-support**: `Polly.Joanna` (Female, natural)

## ⚠️ Important Note

**Provider voices (like `Polly.Joanna`) may require Twilio ConversationRelay or specific account settings.**

If you hear the default `alice` voice instead of the neural voice, it means:
1. Your Twilio account may not have ConversationRelay enabled, OR
2. The voice format needs to be adjusted

**Fallback Options:**
- If neural voices don't work, you can use basic voices: `alice`, `man`, `woman`
- For guaranteed neural voices, you'll need to set up Twilio ConversationRelay (more complex setup)
- Alternatively, use pre-recorded human audio files with `<Play>` verb for the most natural sound

## Testing Different Voices

You can test different voices by updating the `voice` field in any scenario's `aiSettings` and restarting your server.

