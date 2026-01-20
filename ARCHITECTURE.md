# Architecture Overview

## 🏗️ System Architecture

The platform is built with a modular, scalable architecture that separates concerns and makes it easy to add new scenarios and features.

## 📁 Directory Structure

```
llmCalls/
├── config/
│   └── scenarios.js          # Scenario configurations (doctor-appointment, walmart-support, etc.)
├── prompts/
│   └── templates.js          # AI prompt templates for each scenario
├── routes/
│   ├── voiceRoutes.js       # Twilio voice webhook handlers
│   └── apiRoutes.js          # REST API endpoints
├── services/
│   ├── aiService.js          # OpenAI integration service
│   ├── twilioService.js      # Twilio API wrapper
│   └── callStateManager.js   # Call state and conversation management
├── utils/
│   ├── ivrDetector.js       # IVR menu detection and navigation
│   └── transferDetector.js  # Transfer request detection
├── examples/
│   └── usage.js             # Usage examples
├── server.js                # Main Express server
└── index.js                 # Call initiation script
```

## 🔄 Request Flow

### 1. Call Initiation
```
User/API → index.js or /api/calls/initiate
         → twilioService.initiateCall()
         → Twilio API
         → Call connects
```

### 2. Voice Webhook Flow
```
Twilio → /voice (voiceRoutes.js)
      → Call state initialized with scenario
      → Speech gathering starts
      → /process-speech (voiceRoutes.js)
      → IVR Detection (ivrDetector.js)
      → Transfer Detection (transferDetector.js)
      → AI Response (aiService.js)
      → TwiML Response → Twilio
```

### 3. Scenario Processing
```
Speech Input
  ↓
Check IVR Menu? → Yes → Extract options → Press DTMF → Continue
  ↓ No
Check Transfer? → Yes → Transfer call → End
  ↓ No
Check Incomplete? → Yes → Wait for more → Continue
  ↓ No
Generate AI Response → Send to OpenAI → Return response → Continue
```

## 🎯 Key Components

### Scenario System
- **Configuration**: Each scenario defines user data, keywords, AI settings
- **Templates**: Prompt templates customize AI behavior per scenario
- **Dynamic**: Easy to add new scenarios without code changes

### IVR Navigation
- **Detection**: Automatically detects IVR menus in speech
- **Extraction**: Parses menu options and digits
- **Matching**: Matches keywords to find correct option
- **Action**: Presses DTMF automatically

### Transfer System
- **Detection**: Detects transfer requests using phrase patterns
- **Configuration**: Per-scenario transfer settings
- **Execution**: Transfers to configured phone number

### State Management
- **Call State**: Tracks IVR level, menu options, partial speech
- **Conversation History**: Maintains context across interactions
- **Cleanup**: Automatically cleans up old call states

## 🔌 Service Layer

### AI Service
- Handles OpenAI API interactions
- Generates contextual responses based on scenario
- Uses prompt templates for customization

### Twilio Service
- Wraps Twilio API calls
- Handles DTMF sending
- Manages call initiation

### Call State Manager
- Singleton pattern for state management
- Per-call state tracking
- Automatic cleanup of old states

## 📝 Adding a New Scenario

### Step 1: Add Configuration
Edit `config/scenarios.js`:
```javascript
'my-scenario': {
  id: 'my-scenario',
  name: 'My Scenario',
  promptTemplate: 'my-scenario',
  userData: { /* ... */ },
  ivrKeywords: ['keyword1', 'keyword2'],
  // ...
}
```

### Step 2: Add Prompt Template
Edit `prompts/templates.js`:
```javascript
'my-scenario': (userData, conversationContext, isFirstCall) => {
  return {
    system: `Your system prompt...`,
    user: `User message...`
  };
}
```

### Step 3: Use It
```bash
node index.js "" my-scenario
```

## 🚀 Benefits of This Architecture

1. **Modularity**: Each component has a single responsibility
2. **Scalability**: Easy to add new scenarios and features
3. **Maintainability**: Clear separation of concerns
4. **Testability**: Services can be tested independently
5. **Flexibility**: Easy to customize per scenario

## 🔍 Key Design Decisions

### Why Separate Routes?
- Clean separation of webhook handlers vs API endpoints
- Easier to add new endpoints
- Better organization

### Why Service Layer?
- Reusable business logic
- Easier testing
- Centralized API interactions

### Why Scenario System?
- Dynamic configuration without code changes
- Easy to add new use cases
- Customizable per scenario

### Why State Manager?
- Centralized state management
- Automatic cleanup
- Conversation history tracking

## 📊 Data Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  API Route   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Service   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  External   │
│    API      │
└─────────────┘
```

## 🛠️ Extension Points

### Adding New Services
1. Create file in `services/`
2. Export singleton instance
3. Import where needed

### Adding New Routes
1. Create file in `routes/`
2. Export Express router
3. Mount in `server.js`

### Adding New Utils
1. Create file in `utils/`
2. Export functions
3. Import where needed

## 📚 Next Steps

- Add database for persistent storage
- Add authentication/authorization
- Add webhook signature verification
- Add rate limiting
- Add monitoring/logging
- Add tests


