/**
 * Database Connection Service
 * Handles MongoDB connection
 */

import mongoose from 'mongoose';

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
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/llmcalls';
    
    if (!mongoUri || mongoUri === 'mongodb://localhost:27017/llmcalls') {
      console.log('⚠️  MongoDB URI not set. Using default: mongodb://localhost:27017/llmcalls');
      console.log('💡 To use MongoDB Atlas (cloud), set MONGODB_URI in .env');
      console.log('💡 Example: MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/llmcalls');
    }
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
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
    
  } catch (error) {
    const err = error as Error;
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
  } catch (error) {
    const err = error as Error;
    console.error('❌ Error disconnecting from MongoDB:', err.message);
  }
}

/**
 * Check if connected
 */
export function isDbConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

