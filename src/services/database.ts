/**
 * Database Connection Service
 * Handles MongoDB connection
 */

import mongoose from 'mongoose';
import { toError } from '../utils/errorUtils';

let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connect(): Promise<void> {
  if (isConnected) {
    console.log('✅ MongoDB already connected');
    return;
  }

  try {
    // Railway provides MONGO_URL, but we also support MONGODB_URI for flexibility
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
    
    if (!mongoUri) {
      const errorMessage = 'MongoDB connection string is required. Please set MONGODB_URI or MONGO_URL environment variable.';
      console.error('❌', errorMessage);
      console.error('💡 Railway: Add MongoDB service to get MONGO_URL automatically');
      console.error('💡 Or set MONGODB_URI in Railway environment variables');
      console.error('💡 Example: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/llmcalls');
      throw new Error(errorMessage);
    }
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000, // 45 seconds
      connectTimeoutMS: 30000, // 30 seconds
    });
    
    isConnected = true;
    console.log('✅ Connected to MongoDB:', mongoUri.replace(/\/\/.*@/, '//***:***@'));
    
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
      isConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
      isConnected = false;
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
      isConnected = true;
    });
    
  } catch (error: unknown) {
    const err = toError(error);
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
export async function disconnect(): Promise<void> {
  if (!isConnected) return;
  
  try {
    await mongoose.disconnect();
    isConnected = false;
    console.log('✅ Disconnected from MongoDB');
  } catch (error: unknown) {
    const err = toError(error);
    console.error('❌ Error disconnecting from MongoDB:', err.message);
  }
}

/**
 * Check if connected
 */
export function isDbConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}


