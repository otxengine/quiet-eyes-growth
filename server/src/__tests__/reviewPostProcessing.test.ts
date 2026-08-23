/**
 * reviewPostProcessing.ts — shared post-write review pipeline, extracted from
 * collectReviews.ts so both the synchronous tiers and the DataForSEO postback
 * handler run the same competitor-mention / rating-history / alert / event /
 * topic-backfill logic.
 */

jest.mock('../db', () => ({
  prisma: {
    competitor:     { findMany: jest.fn() },
    review:         { findMany: jest.fn(), update: jest.fn() },
    marketSignal:   { findFirst: jest.fn(), create: jest.fn() },
    proactiveAlert: { findFirst: jest.fn(), create: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  },
}));
jest.mock('../lib/eventBus', () => ({ publishEvent: jest.fn().mockResolvedValue('evt1') }));
jest.mock('../lib/reviewTaxonomy', () => ({
  batchExtractTopics: jest.fn(async (items: Array<{ text: string }>) =>
    items.map(() => ({ topics: 'service', topic_sentiment: '{"service":"positive"}' }))),
}));

import { prisma } from '../db';
import { publishEvent } from '../lib/eventBus';
import { batchExtractTopics } from '../lib/reviewTaxonomy';
import {
  detectCompetitorMentions, snapshotRatingHistory, createNegativeReviewAlerts,
  publishNewReviewEvents, backfillTopicsFor,
} from '../lib/reviewPostProcessing';

const competitorFindMany = prisma.competitor.findMany as jest.Mock;
const reviewFindMany     = prisma.review.findMany as jest.Mock;
const reviewUpdate       = prisma.review.update as jest.Mock;
const msFindFirst        = prisma.marketSignal.findFirst as jest.Mock;
const msCreate            = prisma.marketSignal.create as jest.Mock;
const alertFindFirst     = prisma.proactiveAlert.findFirst as jest.Mock;
const alertCreate        = prisma.proactiveAlert.create as jest.Mock;
const execRaw            = prisma.$executeRawUnsafe as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  msCreate.mockResolvedValue({});
  alertCreate.mockResolvedValue({});
  reviewUpdate.mockResolvedValue({});
  execRaw.mockResolvedValue(undefined);
});

describe('detectCompetitorMentions', () => {
  test('creates a MarketSignal when a fresh review mentions a known competitor', async () => {
    competitorFindMany.mockResolvedValue([{ id: 'comp1', name: 'Rival Cafe' }]);
    reviewFindMany.mockResolvedValue([{ id: 'r1', text: 'עדיף מ-Rival Cafe בהרבה', sentiment: 'positive', rating: 5, reviewer_name: 'דני' }]);
    msFindFirst.mockResolvedValue(null);

    await detectCompetitorMentions('bp1', '2024-01-01T00:00:00Z');

    expect(msCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ linked_business: 'bp1', category: 'competitor_mention' }),
    }));
  });

  test('skips when a mention signal already exists in the last 7 days', async () => {
    competitorFindMany.mockResolvedValue([{ id: 'comp1', name: 'Rival Cafe' }]);
    reviewFindMany.mockResolvedValue([{ id: 'r1', text: 'Rival Cafe עדיף', sentiment: 'positive', rating: 5, reviewer_name: 'דני' }]);
    msFindFirst.mockResolvedValue({ id: 'existing' });

    await detectCompetitorMentions('bp1', '2024-01-01T00:00:00Z');

    expect(msCreate).not.toHaveBeenCalled();
  });

  test('no-ops when the business has no tracked competitors', async () => {
    competitorFindMany.mockResolvedValue([]);
    await detectCompetitorMentions('bp1', '2024-01-01T00:00:00Z');
    expect(reviewFindMany).not.toHaveBeenCalled();
    expect(msCreate).not.toHaveBeenCalled();
  });
});

describe('snapshotRatingHistory', () => {
  test('inserts an avg-rating row scoped by the given source label', async () => {
    reviewFindMany.mockResolvedValue([{ rating: 5 }, { rating: 3 }]);
    await snapshotRatingHistory('bp1', 2, 'dataforseo_postback');
    expect(execRaw).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO rating_history'), 'bp1', 4, 2, 2, 'dataforseo_postback');
  });

  test('no-ops when the business has no reviews yet', async () => {
    reviewFindMany.mockResolvedValue([]);
    await snapshotRatingHistory('bp1', 0, 'collectReviews');
    expect(execRaw).not.toHaveBeenCalled();
  });
});

describe('createNegativeReviewAlerts', () => {
  test('creates a ProactiveAlert for a recent negative review', async () => {
    reviewFindMany.mockResolvedValue([{ id: 'r1', reviewer_name: 'דני', rating: 1, text: 'גרוע' }]);
    alertFindFirst.mockResolvedValue(null);

    await createNegativeReviewAlerts('bp1');

    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ alert_type: 'negative_review', priority: 'high', linked_business: 'bp1' }),
    }));
  });

  test('skips when an identical undismissed alert already exists', async () => {
    reviewFindMany.mockResolvedValue([{ id: 'r1', reviewer_name: 'דני', rating: 1, text: 'גרוע' }]);
    alertFindFirst.mockResolvedValue({ id: 'existing' });

    await createNegativeReviewAlerts('bp1');

    expect(alertCreate).not.toHaveBeenCalled();
  });
});

describe('publishNewReviewEvents', () => {
  test('publishes one new_review event per fresh review, with the given source/impact/extraPayload', async () => {
    reviewFindMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    await publishNewReviewEvents('bp1', '2024-01-01T00:00:00Z', {
      source: 'dataforseo_postback', extraPayload: { google_added: 2 }, impact: 'medium',
    });

    expect(publishEvent).toHaveBeenCalledTimes(2);
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'bp1', eventType: 'new_review', source: 'dataforseo_postback',
      payload: { review_id: 'r1', google_added: 2 },
      contextAttrs: { impact: 'medium' },
    }));
  });

  test('defaults source to collectReviews and impact to low when opts omitted', async () => {
    reviewFindMany.mockResolvedValue([{ id: 'r1' }]);
    await publishNewReviewEvents('bp1', '2024-01-01T00:00:00Z');
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'collectReviews', contextAttrs: { impact: 'low' },
    }));
  });
});

describe('backfillTopicsFor', () => {
  test('extracts and writes topics for reviews missing topic_sentiment', async () => {
    reviewFindMany.mockResolvedValue([{ id: 'r1', text: 'שירות מעולה' }]);

    await backfillTopicsFor({ linked_business: 'bp1' }, { key: 'other' });

    expect(batchExtractTopics).toHaveBeenCalledWith([{ text: 'שירות מעולה' }], undefined, { key: 'other' });
    expect(reviewUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { topics: 'service', topic_sentiment: '{"service":"positive"}' },
    });
  });

  test('scopes the query by linked_competitor when given', async () => {
    reviewFindMany.mockResolvedValue([]);
    await backfillTopicsFor({ linked_competitor: 'comp1' }, {});
    expect(reviewFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ linked_competitor: 'comp1' }),
    }));
  });

  test('skips reviews with text under 5 chars and never calls update for them', async () => {
    reviewFindMany.mockResolvedValue([{ id: 'r1', text: 'hi' }]);
    await backfillTopicsFor({ linked_business: 'bp1' }, {});
    expect(batchExtractTopics).not.toHaveBeenCalled();
    expect(reviewUpdate).not.toHaveBeenCalled();
  });

  test('no-ops when nothing is untopiced', async () => {
    reviewFindMany.mockResolvedValue([]);
    await backfillTopicsFor({ linked_business: 'bp1' }, {});
    expect(batchExtractTopics).not.toHaveBeenCalled();
  });
});
