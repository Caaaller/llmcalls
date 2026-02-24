/**
 * Evaluation Service
 * Calculates evaluation metrics for call performance
 */

import CallHistory from '../models/CallHistory';
import { isDbConnected } from './database';

export interface CallEvaluationMetrics {
  totalCalls: number;
  successfulAgentReach: {
    count: number;
    percentage: number;
  };
  transferAfterAgentJoin: {
    count: number;
    percentage: number;
  };
  droppedOrFailed: {
    count: number;
    percentage: number;
  };
  period?: {
    startDate: Date;
    endDate: Date;
  };
}

interface QueryFilter {
  startTime?: {
    $gte?: Date;
    $lte?: Date;
  };
}

class EvaluationService {
  /**
   * Check if MongoDB is available
   */
  private isMongoAvailable(): boolean {
    return isDbConnected();
  }

  /**
   * Build query filter for date range
   */
  private buildDateRangeFilter(startDate?: Date, endDate?: Date): QueryFilter {
    const queryFilter: QueryFilter = {};
    if (startDate || endDate) {
      queryFilter.startTime = {};
      if (startDate) {
        queryFilter.startTime.$gte = startDate;
      }
      if (endDate) {
        queryFilter.startTime.$lte = endDate;
      }
    }
    return queryFilter;
  }

  /**
   * Calculate evaluation metrics for calls
   * @param startDate Optional start date filter
   * @param endDate Optional end date filter
   */
  async calculateMetrics(
    startDate?: Date,
    endDate?: Date
  ): Promise<CallEvaluationMetrics> {
    if (!this.isMongoAvailable()) {
      throw new Error('MongoDB not connected. Cannot calculate metrics.');
    }

    try {
      // Build query filter
      const queryFilter = this.buildDateRangeFilter(startDate, endDate);

      // Get all calls in the period
      const allCalls = await CallHistory.find(queryFilter).lean();

      const totalCalls = allCalls.length;

      if (totalCalls === 0) {
        return {
          totalCalls: 0,
          successfulAgentReach: { count: 0, percentage: 0 },
          transferAfterAgentJoin: { count: 0, percentage: 0 },
          droppedOrFailed: { count: 0, percentage: 0 },
          period: startDate && endDate ? { startDate, endDate } : undefined,
        };
      }

      // 1. Calculate % of calls where AI successfully reaches a live agent
      // A call successfully reaches an agent if:
      // - It has at least one transfer event with success=true
      // - OR it has a transfer event and the call status is 'completed'
      const successfulAgentReachCalls = allCalls.filter(call => {
        const transferEvents =
          call.events?.filter(e => e.eventType === 'transfer') || [];

        // Check if there's a successful transfer
        const hasSuccessfulTransfer = transferEvents.some(
          e => e.success === true
        );

        // Or if there's any transfer and call completed successfully
        const hasTransferAndCompleted =
          transferEvents.length > 0 && call.status === 'completed';

        return hasSuccessfulTransfer || hasTransferAndCompleted;
      });

      const successfulAgentReachCount = successfulAgentReachCalls.length;
      const successfulAgentReachPercentage =
        (successfulAgentReachCount / totalCalls) * 100;

      // 2. Calculate % of calls where transfer happens after agent joins
      // This means: transfer was initiated AND completed successfully
      // We consider this as calls that have a successful transfer event
      const transferAfterAgentJoinCalls = allCalls.filter(call => {
        const transferEvents =
          call.events?.filter(e => e.eventType === 'transfer') || [];

        // Must have at least one successful transfer
        return transferEvents.some(e => e.success === true);
      });

      const transferAfterAgentJoinCount = transferAfterAgentJoinCalls.length;
      const transferAfterAgentJoinPercentage =
        (transferAfterAgentJoinCount / totalCalls) * 100;

      // 3. Calculate % of calls dropped or failed
      // Calls with status 'failed' or 'terminated'
      const droppedOrFailedCalls = allCalls.filter(
        call => call.status === 'failed' || call.status === 'terminated'
      );

      const droppedOrFailedCount = droppedOrFailedCalls.length;
      const droppedOrFailedPercentage =
        (droppedOrFailedCount / totalCalls) * 100;

      return {
        totalCalls,
        successfulAgentReach: {
          count: successfulAgentReachCount,
          percentage: Math.round(successfulAgentReachPercentage * 100) / 100,
        },
        transferAfterAgentJoin: {
          count: transferAfterAgentJoinCount,
          percentage: Math.round(transferAfterAgentJoinPercentage * 100) / 100,
        },
        droppedOrFailed: {
          count: droppedOrFailedCount,
          percentage: Math.round(droppedOrFailedPercentage * 100) / 100,
        },
        period: startDate && endDate ? { startDate, endDate } : undefined,
      };
    } catch (error: unknown) {
      const err = error as Error;
      console.error('❌ Error calculating metrics:', err.message);
      throw error;
    }
  }

  /**
   * Get metrics for the last N days
   */
  async getMetricsForLastDays(
    days: number = 30
  ): Promise<CallEvaluationMetrics> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.calculateMetrics(startDate, endDate);
  }

  /**
   * Get metrics for all time
   */
  async getAllTimeMetrics(): Promise<CallEvaluationMetrics> {
    return this.calculateMetrics();
  }

  /**
   * Get detailed breakdown of calls by status
   */
  async getDetailedBreakdown(startDate?: Date, endDate?: Date) {
    if (!this.isMongoAvailable()) {
      throw new Error('MongoDB not connected. Cannot get breakdown.');
    }

    try {
      const queryFilter = this.buildDateRangeFilter(startDate, endDate);

      const calls = await CallHistory.find(queryFilter).lean();

      const breakdown = {
        byStatus: {
          'in-progress': 0,
          completed: 0,
          failed: 0,
          terminated: 0,
        },
        withTransfers: 0,
        withSuccessfulTransfers: 0,
        averageDuration: 0,
      };

      let totalDuration = 0;
      let callsWithDuration = 0;

      calls.forEach(call => {
        // Count by status
        if (call.status in breakdown.byStatus) {
          breakdown.byStatus[call.status as keyof typeof breakdown.byStatus]++;
        }

        // Count transfers
        const transferEvents =
          call.events?.filter(e => e.eventType === 'transfer') || [];

        if (transferEvents.length > 0) {
          breakdown.withTransfers++;
        }

        if (transferEvents.some(e => e.success === true)) {
          breakdown.withSuccessfulTransfers++;
        }

        // Calculate average duration
        if (call.duration) {
          totalDuration += call.duration;
          callsWithDuration++;
        }
      });

      if (callsWithDuration > 0) {
        breakdown.averageDuration = Math.round(
          totalDuration / callsWithDuration
        );
      }

      return breakdown;
    } catch (error: unknown) {
      const err = error as Error;
      console.error('❌ Error getting breakdown:', err.message);
      throw error;
    }
  }
}

// Singleton instance
const evaluationService = new EvaluationService();

export default evaluationService;
