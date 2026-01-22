# Setup Guide - LLM Calls Project

Complete setup instructions for running the transfer-only phone navigation system.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- MongoDB (local or MongoDB Atlas account)
- Twilio account with a phone number
- OpenAI API key
- ngrok (for local development)

## Step 1: Clone and Install Dependencies

```bash
# Clone the repository
git clone https://github.com/saif482/llmcalls.git
cd llmcalls

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

## Step 2: Environment Variables

Create a `.env` file in the root directory:

```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# Transfer Configuration
TRANSFER_PHONE_NUMBER=+1234567890
USER_PHONE_NUMBER=+1234567890
USER_EMAIL=user@example.com

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Server Configuration
PORT=3000
BASE_URL=https://your-ngrok-url.ngrok-free.app
TWIML_URL=https://your-ngrok-url.ngrok-free.app

# MongoDB Configuration
# Option 1: Local MongoDB
MONGODB_URI=mongodb://localhost:27017/llmcalls

# Option 2: MongoDB Atlas (Cloud - Recommended)
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/llmcalls
```

## Step 3: Setup MongoDB

### Option A: MongoDB Atlas (Cloud - Recommended)

1. Go to https://www.mongodb.com/cloud/atlas
2. Create a free account
3. Create a free M0 cluster
4. Click "Connect" → "Connect your application"
5. Copy the connection string
6. Add it to your `.env` file as `MONGODB_URI`

### Option B: Local MongoDB

```bash
# macOS
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community

# The default connection string is already in .env
```

## Step 4: Setup ngrok (for local development)

```bash
# Install ngrok
brew install ngrok  # macOS
# or download from https://ngrok.com/download

# Start ngrok tunnel
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok-free.app)
# Update TWIML_URL and BASE_URL in .env with this URL
```

## Step 5: Configure Twilio Webhook

1. Go to Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click on your Twilio phone number
3. Under "Voice & Fax", set:
   - **A CALL COMES IN**: Webhook
   - **URL**: `https://your-ngrok-url.ngrok-free.app/voice`
   - **HTTP**: POST

## Step 6: Run the Project

### Terminal 1: Backend Server

```bash
npm run server
# or
node server.js
```

You should see:
```
✅ Connected to MongoDB: mongodb://...
🚀 Server running on port 3000
```

### Terminal 2: React Frontend

```bash
cd frontend
npm start
```

The frontend will open at `http://localhost:3001`

## Step 7: Make a Test Call

### Via React UI:

1. Open `http://localhost:3001`
2. Fill in:
   - **To Phone Number**: The number to call
   - **Transfer Number**: Where to transfer the call
   - **Call Purpose**: e.g., "speak with a representative"
3. Click "Initiate Call"

### Via Command Line:

```bash
node index.js "+1234567890" "+1987654321" "speak with a representative"
```

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
├── index.js             # CLI entry point
└── .env                 # Environment variables (not in git)
```

## Troubleshooting

### MongoDB Connection Failed

- Check if MongoDB is running: `brew services list` (macOS)
- Verify `MONGODB_URI` in `.env`
- For Atlas: Check IP whitelist and credentials

### ngrok URL Changed

- Restart ngrok: `ngrok http 3000`
- Update `TWIML_URL` and `BASE_URL` in `.env`
- Update Twilio webhook URL
- Restart the server

### Call History Not Showing

- Verify MongoDB is connected (check server logs)
- Check browser console for errors
- Ensure `MONGODB_URI` is set correctly

### "Application Error" During Calls

- Check server logs for detailed error messages
- Verify `OPENAI_API_KEY` is set
- Check Twilio webhook URL is correct
- Ensure ngrok is running

## Development Commands

```bash
# Backend
npm run server          # Start backend server
npm start               # Start backend (alias)

# Frontend
cd frontend
npm start               # Start React dev server
npm build               # Build for production
npm test                # Run tests
```

## Production Deployment

1. Deploy backend to a server (Heroku, AWS, etc.)
2. Set environment variables on the hosting platform
3. Update Twilio webhook URL to production URL
4. Build and deploy frontend:
   ```bash
   cd frontend
   npm run build
   # Deploy build/ folder to static hosting
   ```

## Need Help?

- Check `README.md` for overview
- Check `TROUBLESHOOTING_APP_ERROR.md` for common issues
- Check server logs for detailed error messages

