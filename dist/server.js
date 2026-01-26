"use strict";
/**
 * Main Server File
 * Clean, modular Express server
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const database_1 = require("./services/database");
const voiceRoutes_1 = __importDefault(require("./routes/voiceRoutes"));
const apiRoutes_1 = __importDefault(require("./routes/apiRoutes"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const twilio_1 = __importDefault(require("twilio"));
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Trust proxy (needed for ngrok and other reverse proxies)
app.set('trust proxy', true);
// Middleware
app.use(express_1.default.urlencoded({ extended: true }));
app.use(express_1.default.json());
// CORS for React frontend
app.use((req, res, next) => {
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
app.use((req, _res, next) => {
    console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});
// Serve static files
app.use(express_1.default.static('public'));
// Routes
app.use('/', voiceRoutes_1.default);
app.use('/api/auth', authRoutes_1.default);
app.use('/api', apiRoutes_1.default);
// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Root endpoint
app.get('/', (_req, res) => {
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
const errorHandler = (err, req, res, _next) => {
    console.error('Error:', err);
    console.error('Error stack:', err.stack);
    console.error('Request path:', req.path);
    console.error('Request method:', req.method);
    if (req.path.includes('voice') || req.path.includes('process-speech') || req.path.includes('process-dtmf')) {
        const response = new twilio_1.default.twiml.VoiceResponse();
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
async function startServer() {
    try {
        (0, database_1.connect)().catch(_err => {
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
    }
    catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}
startServer();
// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('⚠️ SIGTERM received, shutting down gracefully...');
    await (0, database_1.disconnect)();
    process.exit(0);
});
process.on('SIGINT', async () => {
    console.log('⚠️ SIGINT received, shutting down gracefully...');
    await (0, database_1.disconnect)();
    process.exit(0);
});
exports.default = app;
//# sourceMappingURL=server.js.map