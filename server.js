/**
 * Main Server File
 * Clean, modular Express server
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const database = require('./services/database');

// Import routes
const voiceRoutes = require('./routes/voiceRoutes');
const apiRoutes = require('./routes/apiRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy (needed for ngrok and other reverse proxies)
app.set('trust proxy', true);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS for React frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3001');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Logging middleware
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Serve static files (if needed for browser client)
app.use(express.static('public'));

// Routes - Mount BEFORE other routes to ensure they're matched first
// Mount voice routes at root (so /voice works)
app.use('/', voiceRoutes);
app.use('/api/auth', authRoutes); // Authentication routes (public)
app.use('/api', apiRoutes); // API routes (some may require auth)

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint (won't conflict with /voice since it's GET, not POST)
app.get('/', (req, res) => {
  res.json({
    message: 'LLM Calls API Server',
    version: '2.0.0',
    endpoints: {
      health: '/health',
      scenarios: '/api/scenarios',
      initiateCall: '/api/calls/initiate'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  console.error('Error stack:', err.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);
  
  // If it's a Twilio webhook, return TwiML
  if (req.path.includes('voice') || req.path.includes('process-speech') || req.path.includes('process-dtmf')) {
    const twilio = require('twilio');
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'alice', language: 'en-US' }, 'I apologize, but there was an error. Please try again later.');
    response.hangup();
    res.type('text/xml');
    return res.send(response.toString());
  }
  
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Connect to MongoDB and start server
async function startServer() {
  try {
    // Try to connect to MongoDB (non-blocking)
    database.connect().catch(err => {
      console.log('⚠️  Continuing without MongoDB connection...');
    });
    
    // Start Express server (even if MongoDB fails)
    app.listen(port, () => {
      console.log(`\n🚀 Server running on port ${port}`);
      console.log(`📡 Health check: http://localhost:${port}/health`);
      console.log(`📋 Scenarios: http://localhost:${port}/api/scenarios`);
      console.log(`\n⚠️  For production, use ngrok or similar to expose this server:`);
      console.log(`   ngrok http ${port}`);
      console.log(`   Then update TWIML_URL in .env to: https://your-ngrok-url.ngrok.io/voice`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  await database.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️ SIGINT received, shutting down gracefully...');
  await database.disconnect();
  process.exit(0);
});

module.exports = app;
