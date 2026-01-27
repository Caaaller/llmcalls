/**
 * Call History Service
 * Stores and retrieves call history with full conversation logs using MongoDB
 */

import CallHistory, { MenuOption } from '../models/CallHistory';
import { isDbConnected } from './database';

function isMongoAvailable(): boolean {
  return isDbConnected();
}

export interface CallMetadata {
  to?: string;
  from?: string;
  transferNumber?: string;
  callPurpose?: string;
  customInstructions?: string;
}

class CallHistoryService {
  /**
   * Start tracking a new call
   */
  async startCall(callSid: string, metadata: CallMetadata = {}): Promise<void> {
    if (!isMongoAvailable()) {
      console.log('⚠️  MongoDB not connected. Call history will not be saved.');
      return;
    }
    
    try {
      const callHistory = new CallHistory({
        callSid,
        startTime: new Date(),
        status: 'in-progress',
        metadata: {
          to: metadata.to || undefined,
          from: metadata.from || undefined,
          transferNumber: metadata.transferNumber || undefined,
          callPurpose: metadata.callPurpose || undefined,
          customInstructions: metadata.customInstructions || undefined
        },
        conversation: [],
        dtmfPresses: [],
        events: []
      });
      
      await callHistory.save();
      console.log(`📞 Started tracking call: ${callSid}`);
    } catch (error: any) {
      if (error.code === 11000) {
        console.log(`📞 Call ${callSid} already exists, updating...`);
        await CallHistory.findOneAndUpdate(
          { callSid },
          {
            $set: {
              status: 'in-progress',
              startTime: new Date(),
              metadata: {
                to: metadata.to || undefined,
                from: metadata.from || undefined,
                transferNumber: metadata.transferNumber || undefined,
                callPurpose: metadata.callPurpose || undefined,
                customInstructions: metadata.customInstructions || undefined
              }
            }
          }
        );
      } else {
        console.error('❌ Error starting call tracking:', error.message);
        throw error;
      }
    }
  }

  /**
   * Add a conversation event
   */
  async addConversation(
    callSid: string,
    type: 'user' | 'ai' | 'system',
    text: string,
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      const conversationEntry = {
        type,
        text,
        timestamp: timestamp || new Date()
      };

      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            conversation: conversationEntry,
            events: {
              ...conversationEntry,
              eventType: 'conversation' as const
            }
          }
        }
      );
    } catch (error: any) {
      console.error('❌ Error adding conversation:', error.message);
    }
  }

  /**
   * Record a DTMF press
   */
  async addDTMF(
    callSid: string,
    digit: string,
    reason: string | null = null,
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      const dtmfEvent = {
        digit,
        reason: reason || undefined,
        timestamp: timestamp || new Date()
      };

      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            dtmfPresses: dtmfEvent,
            events: {
              ...dtmfEvent,
              eventType: 'dtmf' as const
            }
          }
        }
      );
    } catch (error: any) {
      console.error('❌ Error adding DTMF:', error.message);
    }
  }

  /**
   * Record an IVR menu detection
   */
  async addIVRMenu(
    callSid: string,
    menuOptions: MenuOption[],
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            events: {
              eventType: 'ivr_menu' as const,
              menuOptions,
              timestamp: timestamp || new Date()
            }
          }
        }
      );
    } catch (error: any) {
      console.error('❌ Error adding IVR menu:', error.message);
    }
  }

  /**
   * Record a transfer attempt
   */
  async addTransfer(
    callSid: string,
    transferNumber: string,
    success: boolean = false,
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            events: {
              eventType: 'transfer' as const,
              transferNumber,
              success,
              timestamp: timestamp || new Date()
            }
          }
        }
      );
    } catch (error: any) {
      console.error('❌ Error adding transfer:', error.message);
    }
  }

  /**
   * Record a termination
   */
  async addTermination(
    callSid: string,
    reason: string,
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            events: {
              eventType: 'termination' as const,
              reason,
              timestamp: timestamp || new Date()
            }
          }
        }
      );
    } catch (error: any) {
      console.error('❌ Error adding termination:', error.message);
    }
  }

  /**
   * End a call
   */
  async endCall(callSid: string, status: 'completed' | 'failed' | 'terminated' = 'completed'): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      const call = await CallHistory.findOne({ callSid });
      if (!call) return;

      const endTime = new Date();
      const duration = endTime.getTime() - call.startTime.getTime();

      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $set: {
            endTime,
            duration,
            status
          }
        }
      );
    } catch (error: any) {
      console.error('❌ Error ending call:', error.message);
    }
  }

  /**
   * Get call history by callSid
   */
  async getCall(callSid: string) {
    if (!isMongoAvailable()) return null;
    
    try {
      const call = await CallHistory.findOne({ callSid }).lean();
      return call;
    } catch (error: any) {
      console.error('❌ Error getting call:', error.message);
      return null;
    }
  }

  /**
   * Get all calls
   */
  async getAllCalls(limit: number = 100) {
    if (!isMongoAvailable()) return [];
    
    try {
      const calls = await CallHistory.find()
        .sort({ startTime: -1 })
        .limit(limit)
        .lean();
      return calls;
    } catch (error: any) {
      console.error('❌ Error getting all calls:', error.message);
      return [];
    }
  }

  /**
   * Get recent calls
   */
  async getRecentCalls(limit: number = 20) {
    return this.getAllCalls(limit);
  }

  /**
   * Clean up old calls
   */
  async cleanup(daysOld: number = 7): Promise<void> {
    if (!isMongoAvailable()) return;
    
    try {
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      const result = await CallHistory.deleteMany({
        startTime: { $lt: cutoffDate }
      });
      
      if (result.deletedCount && result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} old calls`);
      }
    } catch (error: any) {
      console.error('❌ Error cleaning up calls:', error.message);
    }
  }

  /**
   * Get call statistics
   */
  async getStatistics() {
    try {
      const totalCalls = await CallHistory.countDocuments();
      const inProgress = await CallHistory.countDocuments({ status: 'in-progress' });
      const completed = await CallHistory.countDocuments({ status: 'completed' });
      const failed = await CallHistory.countDocuments({ status: 'failed' });
      const terminated = await CallHistory.countDocuments({ status: 'terminated' });
      
      return {
        totalCalls,
        inProgress,
        completed,
        failed,
        terminated
      };
    } catch (error: any) {
      console.error('❌ Error getting statistics:', error.message);
      return null;
    }
  }
}

// Singleton instance
const callHistoryService = new CallHistoryService();

// Cleanup old calls every hour
setInterval(() => {
  callHistoryService.cleanup(7).catch(console.error);
}, 60 * 60 * 1000);

export default callHistoryService;

