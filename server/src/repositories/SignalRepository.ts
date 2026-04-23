/**
 * SignalRepository — data access for raw signals and classified signals.
 * Abstracts Prisma from the intelligence layer.
 */

import { prisma } from '../db';
import { ClassifiedSignal } from '../models';

export class SignalRepository {
  /** Get raw signals for a business, last N hours */
  async getRecentRaw(businessId: string, hours = 48, limit = 50) {
    const since = new Date(Date.now() - hours * 3_600_000);
    return prisma.rawSignal.findMany({
      where: { linked_business: businessId, created_date: { gte: since } },
      orderBy: { created_date: 'desc' },
      take: limit,
    });
  }

  /** Get market signals (processed) for a business */
  async getRecentMarket(businessId: string, hours = 72, limit = 30) {
    const since = new Date(Date.now() - hours * 3_600_000);
    return prisma.marketSignal.findMany({
      where: { linked_business: businessId, created_date: { gte: since } },
      orderBy: { created_date: 'desc' },
      take: limit,
    });
  }

  /** Get unread high-impact signals */
  async getUnreadHighImpact(businessId: string) {
    return prisma.marketSignal.findMany({
      where: {
        linked_business: businessId,
        is_read: false,
        impact_level: { in: ['high', 'critical'] },
      },
      orderBy: { created_date: 'desc' },
      take: 20,
    });
  }

  /** Count signals created since timestamp */
  async countSince(businessId: string, since: Date) {
    return prisma.rawSignal.count({
      where: { linked_business: businessId, created_date: { gte: since } },
    });
  }

  /** Store a classified signal result in automation log for traceability */
  async logClassificationRun(
    businessId: string,
    signalsClassified: number,
    highUrgencyCount: number,
    traceId: string,
  ) {
    return prisma.automationLog.create({
      data: {
        linked_business:  businessId,
        automation_name:  'signalClassification',
        status:           'success',
        items_processed:  signalsClassified,
        start_time:       new Date().toISOString(),
        end_time:         new Date().toISOString(),
        error_message:    null,
      },
    });
  }
}

export const signalRepository = new SignalRepository();
