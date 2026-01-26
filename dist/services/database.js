"use strict";
/**
 * Database Connection Service
 * Handles MongoDB connection
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connect = connect;
exports.disconnect = disconnect;
exports.isDbConnected = isDbConnected;
const mongoose_1 = __importDefault(require("mongoose"));
let isConnected = false;
/**
 * Connect to MongoDB
 */
async function connect() {
    if (isConnected) {
        console.log('✅ MongoDB already connected');
        return;
    }
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/llmcalls';
        if (!mongoUri || mongoUri === 'mongodb://localhost:27017/llmcalls') {
            console.log('⚠️  MongoDB URI not set. Using default: mongodb://localhost:27017/llmcalls');
            console.log('💡 To use MongoDB Atlas (cloud), set MONGODB_URI in .env');
            console.log('💡 Example: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/llmcalls');
        }
        await mongoose_1.default.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
        });
        isConnected = true;
        console.log('✅ Connected to MongoDB:', mongoUri.replace(/\/\/.*@/, '//***:***@'));
        mongoose_1.default.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
            isConnected = false;
        });
        mongoose_1.default.connection.on('disconnected', () => {
            console.log('⚠️ MongoDB disconnected');
            isConnected = false;
        });
        mongoose_1.default.connection.on('reconnected', () => {
            console.log('✅ MongoDB reconnected');
            isConnected = true;
        });
    }
    catch (error) {
        const err = error;
        console.error('❌ MongoDB connection failed:', err.message);
        console.error('\n💡 Options to fix this:');
        console.error('   1. Start local MongoDB: brew services start mongodb-community');
        console.error('   2. Use MongoDB Atlas (free cloud): https://www.mongodb.com/cloud/atlas');
        console.error('   3. Set MONGODB_URI in .env to your MongoDB connection string');
        console.error('\n⚠️  Server will continue without MongoDB. Call history will not be saved.');
    }
}
/**
 * Disconnect from MongoDB
 */
async function disconnect() {
    if (!isConnected)
        return;
    try {
        await mongoose_1.default.disconnect();
        isConnected = false;
        console.log('✅ Disconnected from MongoDB');
    }
    catch (error) {
        const err = error;
        console.error('❌ Error disconnecting from MongoDB:', err.message);
    }
}
/**
 * Check if connected
 */
function isDbConnected() {
    return isConnected && mongoose_1.default.connection.readyState === 1;
}
//# sourceMappingURL=database.js.map