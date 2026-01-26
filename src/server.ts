/**
 * Main Server File
 * Clean, modular Express server
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { connect, disconnect } from './services/database';
import voiceRoutes from './routes/voiceRoutes';
import apiRoutes from './routes/apiRoutes';
import authRoutes from './routes/authRoutes';
import twilio from 'twilio';

const app = express();
const port = process.env.PORT || 3000;

// Trust proxy (needed for ngrok and other reverse proxies)
app.set('trust proxy', true);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS for React frontend
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3001');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Serve static files
app.use(express.static('public'));

// Routes
app.use('/', voiceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
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
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error('Error:', err);
  console.error('Error stack:', err.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);
  
  if (req.path.includes('voice') || req.path.includes('process-speech') || req.path.includes('process-dtmf')) {
    const response = new twilio.twiml.VoiceResponse();
    response.say({ voice: 'alice', language: 'en-US' }, 'I apologize, but there was an error. Please try again later.');
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
    return;
  }
  
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
};

app.use(errorHandler);

// Connect to MongoDB and start server
async function startServer(): Promise<void> {
  try {
    connect().catch(_err => {
      console.log('⚠️  Continuing without MongoDB connection...');
    });
    
    app.listen(port, () => {
      console.log(`\n🚀 Server running on port ${port}`);
      console.log(`📡 Health check: http://localhost:${port}/health`);
      console.log(`📋 Scenarios: http://localhost:${port}/api/scenarios`);
      console.log(`\n⚠️  For production, use ngrok or similar to expose this server:`);
      console.log(`   ngrok http ${port}`);
      console.log(`   Then update TWIML_URL in .env to: https://your-ngrok-url.ngrok.io/voice`);
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to start server:', errorMessage);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully...');
  await disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️ SIGINT received, shutting down gracefully...');
  await disconnect();
  process.exit(0);
});

export default app;

