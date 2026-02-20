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
    return;
  }

  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;

    if (!mongoUri) {
      throw new Error(
        'MongoDB connection string is required. Please set MONGODB_URI or MONGO_URL environment variable.'
      );
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    });

    isConnected = true;
    console.log('MongoDB connected');

    mongoose.connection.on('error', err => {
      console.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
      isConnected = true;
    });
  } catch (error: unknown) {
    const err = toError(error);
    console.error('MongoDB connection failed:', err.message);
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
    console.log('Disconnected from MongoDB');
  } catch (error: unknown) {
    const err = toError(error);
    console.error('Error disconnecting from MongoDB:', err.message);
  }
}

/**
 * Check if connected
 */
export function isDbConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}
