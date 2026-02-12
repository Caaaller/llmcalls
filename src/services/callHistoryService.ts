/**
 * Call History Service
 * Stores and retrieves call history with full conversation logs using MongoDB
 */

import CallHistory, { MenuOption } from '../models/CallHistory';
import { isDbConnected } from './database';
import { isDuplicateKeyError } from '../utils/mongoErrorCodes';
import { getErrorMessage, getMongoErrorCode } from '../utils/errorUtils';

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
          customInstructions: metadata.customInstructions || undefined,
        },
        conversation: [],
        dtmfPresses: [],
        events: [],
      });

      await callHistory.save();
      console.log(`📞 Started tracking call: ${callSid}`);
    } catch (error: unknown) {
      if (isDuplicateKeyError(getMongoErrorCode(error))) {
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
                customInstructions: metadata.customInstructions || undefined,
              },
            },
          }
        );
      } else {
        console.error(
          '❌ Error starting call tracking:',
          getErrorMessage(error)
        );
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
        timestamp: timestamp || new Date(),
      };

      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            conversation: conversationEntry,
            events: {
              ...conversationEntry,
              eventType: 'conversation' as const,
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding conversation:', getErrorMessage(error));
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
        timestamp: timestamp || new Date(),
      };

      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            dtmfPresses: dtmfEvent,
            events: {
              ...dtmfEvent,
              eventType: 'dtmf' as const,
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding DTMF:', getErrorMessage(error));
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
              timestamp: timestamp || new Date(),
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding IVR menu:', getErrorMessage(error));
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
              timestamp: timestamp || new Date(),
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding transfer:', getErrorMessage(error));
    }
  }

  /**
   * Update the most recent transfer event's success status
   */
  async updateTransferStatus(
    callSid: string,
    success: boolean
  ): Promise<void> {
    if (!isMongoAvailable()) return;

    try {
      const call = await CallHistory.findOne({ callSid });
      if (!call) return;

      // Find the most recent transfer event
      const transferEvents = call.events
        ?.map((e, index) => ({ event: e, index }))
        .filter(({ event }) => event.eventType === 'transfer')
        .sort((a, b) => {
          const timeA = a.event.timestamp?.getTime() || 0;
          const timeB = b.event.timestamp?.getTime() || 0;
          return timeB - timeA; // Most recent first
        }) || [];

      if (transferEvents.length === 0) return;

      const mostRecentIndex = transferEvents[0].index;

      // Update the specific transfer event
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $set: {
            [`events.${mostRecentIndex}.success`]: success,
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error updating transfer status:', getErrorMessage(error));
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
              timestamp: timestamp || new Date(),
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding termination:', getErrorMessage(error));
    }
  }

  /**
   * End a call
   */
  async endCall(
    callSid: string,
    status: 'completed' | 'failed' | 'terminated' = 'completed'
  ): Promise<void> {
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
            status,
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error ending call:', getErrorMessage(error));
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
    } catch (error: unknown) {
      console.error('❌ Error getting call:', getErrorMessage(error));
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
    } catch (error: unknown) {
      console.error('❌ Error getting all calls:', getErrorMessage(error));
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
        startTime: { $lt: cutoffDate },
      });

      if (result.deletedCount && result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} old calls`);
      }
    } catch (error: unknown) {
      console.error('❌ Error cleaning up calls:', getErrorMessage(error));
    }
  }

  /**
   * Get call statistics
   */
  async getStatistics() {
    try {
      const totalCalls = await CallHistory.countDocuments();
      const inProgress = await CallHistory.countDocuments({
        status: 'in-progress',
      });
      const completed = await CallHistory.countDocuments({
        status: 'completed',
      });
      const failed = await CallHistory.countDocuments({ status: 'failed' });
      const terminated = await CallHistory.countDocuments({
        status: 'terminated',
      });

      return {
        totalCalls,
        inProgress,
        completed,
        failed,
        terminated,
      };
    } catch (error: unknown) {
      console.error('❌ Error getting statistics:', getErrorMessage(error));
      return null;
    }
  }
}

// Singleton instance
const callHistoryService = new CallHistoryService();

// Cleanup old calls every hour
setInterval(
  () => {
    callHistoryService.cleanup(7).catch(console.error);
  },
  60 * 60 * 1000
);

export default callHistoryService;
