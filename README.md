# LLM Calls - Transfer-Only Phone Navigation System

AI-powered phone navigation system that automatically navigates IVR menus and transfers calls to live representatives.

## Quick Start

See [SETUP.md](./SETUP.md) for complete setup instructions.

### Quick Setup:

1. **Install dependencies:**
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

2. **Configure `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Start MongoDB** (or use MongoDB Atlas)

4. **Start ngrok:**
   ```bash
   ngrok http 3000
   ```

5. **Update `.env`** with ngrok URL

6. **Run backend:**
   ```bash
   npm run server
   ```

7. **Run frontend** (in another terminal):
   ```bash
   cd frontend && npm start
   ```

8. **Open** http://localhost:3001

## Features

- 🤖 AI-powered IVR navigation
- 📞 Automatic call transfer to representatives
- 📋 Complete call history with MongoDB
- 🎯 Transfer-only mode (no appointment booking)
- 💬 Full conversation logging
- 🔢 DTMF press tracking
- 📊 Call analytics and reporting

## Project Structure

```
llmcalls/
├── config/              # Configuration files
├── models/              # MongoDB models
├── prompts/             # AI prompt templates
├── routes/              # Express routes
├── services/            # Business logic services
├── utils/               # Utility functions
├── frontend/            # React frontend
├── server.js            # Main server file
└── index.js             # CLI entry point
```

## Documentation

- [SETUP.md](./SETUP.md) - Complete setup guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [TRANSFER_ONLY_SETUP.md](./TRANSFER_ONLY_SETUP.md) - Transfer-only mode details
- [ANALYTICS_REQUIREMENTS.md](./ANALYTICS_REQUIREMENTS.md) - Analytics features

# LLM Calls - Dynamic Voice AI Platform

A scalable Node.js platform for AI-powered voice calls with multiple configurable scenarios.

## 🏗️ Project Structure

```
llmCalls/
├── config/
│   └── scenarios.js          # Scenario configurations
├── prompts/
│   └── templates.js          # AI prompt templates
├── routes/
│   ├── voiceRoutes.js        # Twilio voice webhooks
│   └── apiRoutes.js          # REST API endpoints
├── services/
│   ├── aiService.js          # OpenAI integration
│   ├── twilioService.js      # Twilio API wrapper
│   └── callStateManager.js   # Call state management
├── utils/
│   ├── ivrDetector.js        # IVR menu detection
│   └── transferDetector.js   # Transfer detection
├── server.js                 # Main Express server
├── index.js                  # Call initiation script
└── package.json
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Call Configuration
TO_PHONE_NUMBER=+923234856925
TRANSFER_PHONE_NUMBER=+923234856925

# Server Configuration
PORT=3000
BASE_URL=https://your-ngrok-url.ngrok-free.app
TWIML_URL=https://your-ngrok-url.ngrok-free.app/voice
```

### 3. Start the Server

```bash
npm run server
```

### 4. Expose with ngrok

```bash
ngrok http 3000
```

Update `TWIML_URL` in `.env` with your ngrok URL.

### 5. Initiate a Call

```bash
# Using default scenario (doctor-appointment)
node index.js

# Using specific scenario
node index.js "" walmart-support
```

## 📋 Available Scenarios

### 1. Doctor Appointment (`doctor-appointment`)
- Books medical appointments
- Handles IVR navigation
- Provides patient information when asked

### 2. Walmart Support (`walmart-support`)
- Customer support inquiries
- Order tracking
- Auto-transfer to representative

### 3. Insurance Claim (`insurance-claim`)
- File insurance claims
- Check claim status
- Policy inquiries

## 🔧 Adding New Scenarios

1. **Add scenario configuration** in `config/scenarios.js`:

```javascript
'my-scenario': {
  id: 'my-scenario',
  name: 'My Scenario',
  description: 'Description of what this scenario does',
  promptTemplate: 'my-scenario',
  userData: {
    name: 'John Doe',
    phone: '1234567890',
    // ... other data
  },
  ivrKeywords: ['keyword1', 'keyword2'],
  transferKeywords: ['transfer', 'representative'],
  transferEnabled: true,
  aiSettings: {
    model: 'gpt-3.5-turbo',
    maxTokens: 100,
    temperature: 0.7,
    voice: 'alice',
    language: 'en-US'
  }
}
```

2. **Add prompt template** in `prompts/templates.js`:

```javascript
'my-scenario': (userData, conversationContext, isFirstCall) => {
  return {
    system: `Your system prompt here...`,
    user: `User message here...`
  };
}
```

3. **Use the scenario**:

```bash
node index.js "" my-scenario
```

## 📡 API Endpoints

### Get All Scenarios
```bash
GET /api/scenarios
```

### Get Scenario Details
```bash
GET /api/scenarios/:id
```

### Initiate Call
```bash
POST /api/calls/initiate
Content-Type: application/json

{
  "to": "+1234567890",
  "scenarioId": "doctor-appointment",
  "from": "+1234567890" // optional
}
```

## 🎯 Features

- ✅ **Multiple Scenarios**: Easily configure different use cases
- ✅ **Dynamic Prompts**: Customizable AI prompts per scenario
- ✅ **IVR Navigation**: Automatic DTMF detection and navigation
- ✅ **Call Transfer**: Intelligent transfer detection
- ✅ **Modular Architecture**: Clean, maintainable code structure
- ✅ **State Management**: Track call state and conversation history
- ✅ **Error Handling**: Robust error handling and logging

## 🔍 How It Works

1. **Call Initiation**: Call is initiated with a scenario ID
2. **Voice Webhook**: Twilio calls `/voice` endpoint
3. **Speech Processing**: System listens for speech
4. **IVR Detection**: Detects IVR menus and presses DTMF automatically
5. **AI Response**: Generates contextual responses using OpenAI
6. **Transfer Detection**: Detects transfer requests and transfers call
7. **State Management**: Tracks conversation history and call state

## 📝 Configuration

### Scenario Configuration

Each scenario can have:
- `userData`: User information for the AI
- `ivrKeywords`: Keywords to match in IVR menus
- `transferKeywords`: Keywords that trigger transfers
- `aiSettings`: OpenAI model settings
- `promptTemplate`: Template name for prompts

### Prompt Templates

Prompts are defined in `prompts/templates.js` and can access:
- `userData`: User information
- `conversationContext`: Current conversation context
- `isFirstCall`: Whether this is the first interaction

## 🛠️ Development

### Project Structure Benefits

- **Separation of Concerns**: Each module has a single responsibility
- **Easy Testing**: Services can be tested independently
- **Scalability**: Easy to add new features and scenarios
- **Maintainability**: Clear code organization

### Adding New Features

1. **New Service**: Add to `services/` directory
2. **New Route**: Add to `routes/` directory
3. **New Utility**: Add to `utils/` directory
4. **New Config**: Add to `config/` directory

## 📚 Documentation

- Scenario configurations: `config/scenarios.js`
- Prompt templates: `prompts/templates.js`
- API routes: `routes/apiRoutes.js`
- Voice routes: `routes/voiceRoutes.js`

## 🐛 Troubleshooting

### Call Not Connecting
- Check `TWIML_URL` in `.env` matches your ngrok URL
- Ensure ngrok is running
- Verify Twilio credentials

### AI Not Responding
- Check `OPENAI_API_KEY` is set
- Verify scenario configuration
- Check server logs for errors

### IVR Not Working
- Verify `ivrKeywords` match menu options
- Check DTMF detection logs
- Ensure speech recognition is working

## 📄 License

ISC


