/**
 * Call History Service
 * Stores and retrieves call history with full conversation logs using MongoDB
 */

import CallHistory from '../models/CallHistory';
import { MenuOption } from '../types/menu';
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
  userId?: string;
}

class CallHistoryService {
  /**
   * Start tracking a new call
   */
  async startCall(callSid: string, metadata: CallMetadata = {}): Promise<void> {
    if (!isMongoAvailable()) {
      console.warn('MongoDB not connected. Call history will not be saved.');
      return;
    }

    try {
      const callHistory = new CallHistory({
        callSid,
        ...(metadata.userId && { userId: metadata.userId }),
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
  async updateTransferStatus(callSid: string, success: boolean): Promise<void> {
    if (!isMongoAvailable()) return;

    try {
      const call = await CallHistory.findOne({ callSid });
      if (!call) return;

      // Find the most recent transfer event
      const transferEvents =
        call.events
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
      console.error(
        '❌ Error updating transfer status:',
        getErrorMessage(error)
      );
    }
  }

  /**
   * Record a hold queue detection
   */
  async addHoldDetected(
    callSid: string,
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;

    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            events: {
              eventType: 'hold' as const,
              timestamp: timestamp || new Date(),
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding hold event:', getErrorMessage(error));
    }
  }

  /**
   * Check if a call reached a hold queue
   */
  async hasReachedHoldQueue(callSid: string): Promise<boolean> {
    const call = await this.getCall(callSid);
    if (!call?.events) return false;
    return call.events.some(e => e.eventType === 'hold');
  }

  /**
   * Get the termination reason for a call (e.g. 'closed_no_menu', 'voicemail', 'dead_end')
   */
  async getTerminationReason(callSid: string): Promise<string | null> {
    const call = await this.getCall(callSid);
    if (!call?.events) return null;
    const termination = call.events.find(e => e.eventType === 'termination');
    return termination?.reason ?? null;
  }

  /**
   * Record an info request (agent asked user for missing info)
   */
  async addInfoRequest(
    callSid: string,
    requestedInfo: string,
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;

    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            events: {
              eventType: 'info_request' as const,
              text: requestedInfo,
              timestamp: timestamp || new Date(),
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding info request:', getErrorMessage(error));
    }
  }

  /**
   * Record an info response (user replied with the requested info)
   */
  async addInfoResponse(
    callSid: string,
    response: string,
    via: 'sms' | 'web',
    timestamp: Date | null = null
  ): Promise<void> {
    if (!isMongoAvailable()) return;

    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        {
          $push: {
            events: {
              eventType: 'info_response' as const,
              text: response,
              reason: via,
              timestamp: timestamp || new Date(),
            },
          },
        }
      );
    } catch (error: unknown) {
      console.error('❌ Error adding info response:', getErrorMessage(error));
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
   * Store recording URL for a call (called from Twilio recording-status webhook)
   */
  async setRecordingUrl(callSid: string, recordingUrl: string): Promise<void> {
    if (!isMongoAvailable()) return;

    try {
      await CallHistory.findOneAndUpdate(
        { callSid },
        { $set: { recordingUrl } }
      );
    } catch (error: unknown) {
      console.error('❌ Error setting recording URL:', getErrorMessage(error));
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
   * Get all DTMF digits pressed during a call (in order)
   */
  async getDTMFDigits(callSid: string): Promise<Array<string>> {
    const call = await this.getCall(callSid);
    if (!call?.dtmfPresses) return [];
    return call.dtmfPresses.map(e => e.digit);
  }

  /**
   * Check if a call had at least one successful transfer
   */
  async hasSuccessfulTransfer(callSid: string): Promise<boolean> {
    const call = await this.getCall(callSid);
    if (!call?.events) return false;
    // Any transfer event counts — success field was never being set to true
    return call.events.some(e => e.eventType === 'transfer');
  }

  /**
   * Check if a real human introduced themselves in this call's transcript.
   * Looks for patterns like "This is [Name]", "My name is [Name]", "You've reached [Name]",
   * "I'm [Name]", "You're speaking to [Name]", "[Name] speaking".
   * Used to verify that a transfer actually reached a human vs. just an IVR prompt.
   */
  async hasHumanIntroduction(callSid: string): Promise<boolean> {
    const call = await this.getCall(callSid);
    if (!call?.events) return false;
    const INTRO =
      /\b[Tt]his is [A-Z][a-z]+[,.!?\s]|\b[Mm]y name is [A-Z][a-z]+[,.!?\s]|\b[Yy]ou('ve| have) reached [A-Z][a-z]+|\bI'm [A-Z][a-z]+[,.!?\s]|\b[Yy]ou('re| are) (now )?(connected|speaking|talking) (to|with) [A-Z][a-z]+|\b[A-Z][a-z]+ speaking[,.!?\s]/;
    return call.events.some(
      e =>
        e.eventType === 'conversation' &&
        (e as { type?: string }).type === 'user' &&
        INTRO.test(((e as { text?: string }).text as string) || '')
    );
  }

  /**
   * Check if a call had an application error (TTS failure post-hangup, etc.)
   */
  async hasApplicationError(callSid: string): Promise<boolean> {
    const call = await this.getCall(callSid);
    if (!call?.events) return false;
    return call.events.some(
      e =>
        e.eventType === 'conversation' &&
        (e as { type?: string }).type === 'ai' &&
        /application error has occurred/.test(
          ((e as { text?: string }).text as string) || ''
        )
    );
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
  async getRecentCalls(limit: number = 20, userId?: string) {
    if (!isMongoAvailable()) return [];

    try {
      const query = userId ? { userId } : {};
      const calls = await CallHistory.find(query)
        .sort({ startTime: -1 })
        .limit(limit)
        .lean();
      return calls;
    } catch (error: unknown) {
      console.error('❌ Error getting recent calls:', getErrorMessage(error));
      return [];
    }
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
