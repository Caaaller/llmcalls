/**
 * Main Server File
 * Clean, modular Express server
 */

import 'dotenv/config';
import express, {
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from 'express';
import path from 'path';
import { connect, disconnect } from './services/database';
import voiceRoutes from './routes/voiceRoutes';
import apiRoutes from './routes/apiRoutes';
import authRoutes from './routes/authRoutes';
import twilio from 'twilio';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

// Trust proxy (needed for ngrok and other reverse proxies)
app.set('trust proxy', true);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS for React frontend
const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
  process.env.BASE_URL,
].filter(Boolean) as string[];

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV === 'production' && process.env.BASE_URL) {
    res.header('Access-Control-Allow-Origin', process.env.BASE_URL);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (
    req.body &&
    typeof req.body === 'object' &&
    Object.keys(req.body).length > 0
  ) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Serve static files from public directory
app.use(express.static('public'));

// Routes (API routes before static file serving)
app.use('/voice', voiceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  const startTime = Date.now();
  console.log(`\n📊 Health check requested at ${new Date().toISOString()}`);

  const response = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  };

  const responseTime = Date.now() - startTime;
  console.log(`📊 Health check response time: ${responseTime}ms`);
  console.log(`📊 Response:`, JSON.stringify(response));

  res.status(200).json(response);
});

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendBuildPath = path.join(process.cwd(), 'frontend/build');
  app.use(express.static(frontendBuildPath));

  // Catch-all handler: send back React's index.html file for client-side routing
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Don't serve React app for API routes or voice routes
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/voice') ||
      req.path.startsWith('/health')
    ) {
      return next();
    }
    // Only handle GET requests for the catch-all
    if (req.method === 'GET') {
      res.sendFile(path.join(frontendBuildPath, 'index.html'));
    } else {
      next();
    }
  });
} else {
  // Development: API info endpoint
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      message: 'LLM Calls API Server',
      version: '2.0.0',
      mode: 'development',
      endpoints: {
        health: '/health',
        api: '/api',
        voice: '/voice',
      },
      note: 'Frontend runs separately on http://localhost:3001',
    });
  });
}

// Error handling middleware
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error('Error:', err);
  console.error('Error stack:', err.stack);
  console.error('Request path:', req.path);
  console.error('Request method:', req.method);

  if (
    req.path.includes('voice') ||
    req.path.includes('process-speech') ||
    req.path.includes('process-dtmf')
  ) {
    const response = new twilio.twiml.VoiceResponse();
    response.say(
      { voice: 'alice', language: 'en-US' },
      'I apologize, but there was an error. Please try again later.'
    );
    response.hangup();
    res.type('text/xml');
    res.send(response.toString());
    return;
  }

  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
};

app.use(errorHandler);

// Connect to MongoDB and start server
async function startServer(): Promise<void> {
  console.log('\n📋 ========================================');
  console.log('📋 SERVER STARTUP SEQUENCE');
  console.log('📋 ========================================');
  console.log(`📋 Timestamp: ${new Date().toISOString()}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📋 Port: ${port}`);
  console.log(`📋 PORT env var: ${process.env.PORT || 'NOT SET'}`);
  console.log(`📋 Process PID: ${process.pid}`);
  console.log(`📋 Node version: ${process.version}`);
  console.log(`📋 Working directory: ${process.cwd()}`);

  try {
    // Log environment variables (masked for security)
    console.log('\n📋 Environment Variables Check:');
    console.log(
      `   MONGODB_URI: ${process.env.MONGODB_URI ? 'SET (masked)' : 'NOT SET'}`
    );
    console.log(
      `   MONGO_URL: ${process.env.MONGO_URL ? 'SET (masked)' : 'NOT SET'}`
    );
    console.log(
      `   DATABASE_URL: ${process.env.DATABASE_URL ? 'SET (masked)' : 'NOT SET'}`
    );
    console.log(`   MONGOHOST: ${process.env.MONGOHOST ? 'SET' : 'NOT SET'}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'NOT SET'}`);

    // Attempt to connect to MongoDB, but don't block server startup
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
    console.log('\n📋 MongoDB Connection Setup:');
    if (mongoUri) {
      const maskedUri = mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
      console.log(`   ✅ MongoDB URI found: ${maskedUri}`);
      console.log('   🔄 Starting MongoDB connection (non-blocking)...');
      const connectionStartTime = Date.now();

      // Try to connect, but don't block server startup
      connect()
        .then(() => {
          const connectionTime = Date.now() - connectionStartTime;
          console.log(
            `   ✅ MongoDB connection successful (took ${connectionTime}ms)`
          );
        })
        .catch(err => {
          const connectionTime = Date.now() - connectionStartTime;
          console.error(
            `   ❌ MongoDB connection failed after ${connectionTime}ms:`,
            err instanceof Error ? err.message : String(err)
          );
          console.log(
            '   ⚠️  Server will continue, but database operations will fail.'
          );
          console.log('   💡 Please check MongoDB connection in Railway.');
          console.log(
            '   💡 Railway: Ensure MongoDB service is added and MONGO_URL is available.'
          );
        });
    } else {
      console.log('   ⚠️  MONGODB_URI or MONGO_URL not set.');
      console.log('   ⚠️  Database operations will fail.');
      console.log(
        '   💡 Railway: Add MongoDB service to get MONGO_URL automatically'
      );
      console.log('   💡 Or set MONGODB_URI in Railway environment variables.');
    }

    console.log('\n📋 Starting HTTP Server...');
    const serverStartTime = Date.now();

    app.listen(port, '0.0.0.0', () => {
      const serverStartTimeElapsed = Date.now() - serverStartTime;
      console.log('\n✅ ========================================');
      console.log('✅ SERVER STARTED SUCCESSFULLY');
      console.log('✅ ========================================');
      console.log(`✅ Server running on port ${port}`);
      console.log(`✅ Bind address: 0.0.0.0 (all interfaces)`);
      console.log(`✅ Startup time: ${serverStartTimeElapsed}ms`);
      console.log(`✅ Health check: http://0.0.0.0:${port}/health`);
      console.log(
        `✅ Health check (external): https://your-app.railway.app/health`
      );
      console.log(`✅ Timestamp: ${new Date().toISOString()}`);

      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `\n⚠️  For production, use ngrok or similar to expose this server:`
        );
        console.log(`   ngrok http ${port}`);
        console.log(
          `   Then update TWIML_URL in .env to: https://your-ngrok-url.ngrok.io/voice`
        );
      }
      console.log('✅ ========================================\n');
    });

    // Log uncaught errors
    process.on('uncaughtException', (err: Error) => {
      console.error('\n❌ ========================================');
      console.error('❌ UNCAUGHT EXCEPTION');
      console.error('❌ ========================================');
      console.error('❌ Error:', err.message);
      console.error('❌ Stack:', err.stack);
      console.error('❌ ========================================\n');
    });

    process.on('unhandledRejection', (reason: unknown) => {
      console.error('\n❌ ========================================');
      console.error('❌ UNHANDLED REJECTION');
      console.error('❌ ========================================');
      console.error('❌ Reason:', reason);
      console.error('❌ ========================================\n');
    });

    // Log when server is closing
    process.on('SIGTERM', () => {
      console.log('\n⚠️  SIGTERM received, shutting down gracefully...');
    });

    process.on('SIGINT', () => {
      console.log('\n⚠️  SIGINT received, shutting down gracefully...');
    });
  } catch (error) {
    console.error('\n❌ ========================================');
    console.error('❌ SERVER STARTUP FAILED');
    console.error('❌ ========================================');
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error:', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('❌ Stack:', error.stack);
    }
    console.error('❌ ========================================\n');
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
