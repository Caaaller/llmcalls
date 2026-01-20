/**
 * Database Connection Service
 * Handles MongoDB connection
 */

const mongoose = require('mongoose');

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
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5 seconds
    });
    
    isConnected = true;
    console.log('✅ Connected to MongoDB:', mongoUri.replace(/\/\/.*@/, '//***:***@')); // Hide credentials in logs
    
    // Handle connection events
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
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('\n💡 Options to fix this:');
    console.error('   1. Start local MongoDB: brew services start mongodb-community');
    console.error('   2. Use MongoDB Atlas (free cloud): https://www.mongodb.com/cloud/atlas');
    console.error('   3. Set MONGODB_URI in .env to your MongoDB connection string');
    console.error('\n⚠️  Server will continue without MongoDB. Call history will not be saved.');
    // Don't throw error - allow server to start without MongoDB
    // throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
async function disconnect() {
  if (!isConnected) return;
  
  try {
    await mongoose.disconnect();
    isConnected = false;
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error disconnecting from MongoDB:', error.message);
  }
}

/**
 * Check if connected
 */
function isDbConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

module.exports = {
  connect,
  disconnect,
  isDbConnected
};

