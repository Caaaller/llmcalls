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
import { requestLogger } from './middleware/requestLogger';
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

// Request logging
app.use(requestLogger);

// Routes (API routes before static file serving)
console.log('📋 Registering routes...');
app.use('/voice', voiceRoutes);
console.log('  ✅ /voice routes registered');
app.use('/api/auth', authRoutes);
console.log('  ✅ /api/auth routes registered');
app.use('/api', apiRoutes);
console.log('  ✅ /api routes registered');

// Serve static files from public directory (after routes to avoid conflicts)
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendBuildPath = path.join(process.cwd(), 'frontend/build');
  
  // Serve static files from frontend build
  app.use(express.static(frontendBuildPath));

  // Catch-all handler: send back React's index.html file for client-side routing
  // IMPORTANT: This must come AFTER all API routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Don't serve React app for API routes, voice routes, or health check
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/voice') ||
      req.path.startsWith('/health')
    ) {
      console.log(`   ⚠️  Catch-all skipping: ${req.method} ${req.path} (API route)`);
      return next(); // Let it fall through to 404 handler if route doesn't exist
    }
    // Only handle GET requests for the catch-all
    if (req.method === 'GET') {
      console.log(`   📄 Serving React app for: ${req.method} ${req.path}`);
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

// 404 handler for unmatched routes
app.use((req: Request, res: Response) => {
  console.error(`\n❌ 404 - Route not found: ${req.method} ${req.path}`);
  console.error(`   Original URL: ${req.originalUrl}`);
  console.error(`   Query:`, req.query);
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

// Error handling middleware
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);

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
  console.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`Port: ${port} | Node ${process.version} | PID ${process.pid}`);
  console.log(`Working directory: ${process.cwd()}`);

  // Environment variables check
  console.log('Environment Variables Check:');
  console.log(
    `  MONGODB_URI: ${process.env.MONGODB_URI ? 'SET (masked)' : 'NOT SET'}`
  );
  console.log(
    `  MONGO_URL: ${process.env.MONGO_URL ? 'SET (masked)' : 'NOT SET'}`
  );
  console.log(
    `  DATABASE_URL: ${process.env.DATABASE_URL ? 'SET (masked)' : 'NOT SET'}`
  );
  console.log(`  MONGOHOST: ${process.env.MONGOHOST ? 'SET' : 'NOT SET'}`);

  // MongoDB connection setup
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (mongoUri) {
    const maskedUri = mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
    console.log(`MongoDB URI found: ${maskedUri}`);
    const connectionStartTime = Date.now();

    connect()
      .then(() => {
        const connectionTime = Date.now() - connectionStartTime;
        console.log(`MongoDB connection successful (took ${connectionTime}ms)`);
      })
      .catch(err => {
        const connectionTime = Date.now() - connectionStartTime;
        console.error(
          `MongoDB connection failed after ${connectionTime}ms:`,
          err instanceof Error ? err.message : String(err)
        );
        console.log('Server will continue, but database operations will fail.');
      });
  } else {
    console.warn('No MongoDB URI set - database operations will fail');
  }

  const serverStartTime = Date.now();
  app.listen(port, '0.0.0.0', () => {
    const startupTime = Date.now() - serverStartTime;
    console.log(`Server running on port ${port} (startup: ${startupTime}ms)`);
  });

  process.on('uncaughtException', (err: Error) => {
    console.error('Uncaught exception:', err.message, err.stack);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    console.error('Unhandled rejection:', reason);
  });
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
