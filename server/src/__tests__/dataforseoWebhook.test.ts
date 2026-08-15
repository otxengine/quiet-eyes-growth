/**
 * DataForSEO postback webhook — secret gate + idempotent task-completion pipeline.
 */

jest.mock('../db', () => ({
  prisma: {
    dataForSeoReviewTask: { findUnique: jest.fn(), update: jest.fn() },
    businessProfile:      { findFirst: jest.fn() },
    review:                { findMany: jest.fn(), create: jest.fn() },
  },
}));
jest.mock('../lib/automationLog', () => ({ writeAutomationLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/reviewTaxonomy', () => ({
  batchExtractTopics: jest.fn(async (items: Array<{ text: string }>) =>
    items.map(() => ({ topics: 'service', topic_sentiment: '{}' }))),
}));
jest.mock('../lib/businessProfile', () => ({ getSectorProfile: jest.fn().mockReturnValue(null) }));
jest.mock('../lib/reviewTopicPacks', () => ({ resolveTopicSet: jest.fn().mockReturnValue({}) }));
jest.mock('../lib/signalGuard', () => ({ normReviewOrigin: jest.fn((v: string) => v) }));
jest.mock('../lib/reviewPostProcessing', () => ({
  detectCompetitorMentions: jest.fn().mockResolvedValue(undefined),
  snapshotRatingHistory:    jest.fn().mockResolvedValue(undefined),
  createNegativeReviewAlerts: jest.fn().mockResolvedValue(undefined),
  publishNewReviewEvents:  jest.fn().mockResolvedValue(undefined),
  backfillTopicsFor:       jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../db';
import { writeAutomationLog } from '../lib/automationLog';
import {
  detectCompetitorMentions, snapshotRatingHistory, createNegativeReviewAlerts,
  publishNewReviewEvents, backfillTopicsFor,
} from '../lib/reviewPostProcessing';
import { dataforseoWebhookHandler, processDataForSeoReviewsPostback } from '../routes/webhooks/dataforseo';

const taskFindUnique = prisma.dataForSeoReviewTask.findUnique as jest.Mock;
const taskUpdate     = prisma.dataForSeoReviewTask.update as jest.Mock;
const bpFindFirst    = prisma.businessProfile.findFirst as jest.Mock;
const reviewFindMany = prisma.review.findMany as jest.Mock;
const reviewCreate   = prisma.review.create as jest.Mock;

const OLD_ENV = process.env;

function makeReqRes(query: any, body: any) {
  const json = jest.fn().mockReturnThis();
  const sendStatus = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnThis();
  const req: any = { query, body };
  const res: any = { json, status, sendStatus };
  return { req, res, json, status, sendStatus };
}

const OWN_TASK_ROW = {
  task_id: 'task123', task_type: 'own', business_profile_id: 'bp1',
  linked_competitor: null, status: 'pending', requested_at: new Date('2024-01-01T00:00:00Z'),
};
const COMPETITOR_TASK_ROW = {
  task_id: 'task456', task_type: 'competitor', business_profile_id: 'bp1',
  linked_competitor: 'comp1', status: 'pending', requested_at: new Date('2024-01-01T00:00:00Z'),
};

function taskPayload(overrides: any = {}) {
  return {
    tasks: [{
      id: 'task123', status_code: 20000, status_message: 'Ok.', cost: 0.01,
      result: [{ items: [{ review_text: 'שירות מעולה, ממליץ בחום', rating: { value: 5 }, review_id: 'rev1', profile_name: 'דני', timestamp: '2024-01-02T00:00:00Z' }] }],
      ...overrides,
    }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, DATAFORSEO_WEBHOOK_SECRET: 's3cr3t' };
  bpFindFirst.mockResolvedValue({ id: 'bp1', google_place_id: 'ChIJabc' });
  reviewFindMany.mockResolvedValue([]);
  reviewCreate.mockImplementation(async (args: any) => args.data);
  taskUpdate.mockResolvedValue({});
});

afterAll(() => { process.env = OLD_ENV; });

describe('dataforseoWebhookHandler — secret gate', () => {
  test('rejects with 403 when secret query param is missing', () => {
    const { req, res, status, json } = makeReqRes({}, {});
    dataforseoWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'unauthorized' });
  });

  test('rejects with 403 when secret does not match', () => {
    const { req, res, status } = makeReqRes({ secret: 'wrong' }, {});
    dataforseoWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(403);
  });

  test('rejects with 403 when DATAFORSEO_WEBHOOK_SECRET is unset on the server', () => {
    delete process.env.DATAFORSEO_WEBHOOK_SECRET;
    const { req, res, status } = makeReqRes({ secret: 'anything' }, {});
    dataforseoWebhookHandler(req, res);
    expect(status).toHaveBeenCalledWith(403);
  });

  test('acks 200 immediately on a valid secret, before async processing resolves', () => {
    taskFindUnique.mockResolvedValue(null); // processing will no-op
    const { req, res, sendStatus } = makeReqRes({ secret: 's3cr3t' }, taskPayload());
    dataforseoWebhookHandler(req, res);
    expect(sendStatus).toHaveBeenCalledWith(200);
  });
});

describe('processDataForSeoReviewsPostback', () => {
  test('ignores payloads missing tasks[0].id', async () => {
    await processDataForSeoReviewsPostback({ tasks: [{}] });
    expect(taskFindUnique).not.toHaveBeenCalled();
  });

  test('ignores an unknown task_id (no matching DataForSeoReviewTask row)', async () => {
    taskFindUnique.mockResolvedValue(null);
    await processDataForSeoReviewsPostback(taskPayload());
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test('idempotent: skips reprocessing a task that is no longer pending', async () => {
    taskFindUnique.mockResolvedValue({ ...OWN_TASK_ROW, status: 'complete' });
    await processDataForSeoReviewsPostback(taskPayload());
    expect(reviewCreate).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  test('normalizes DataForSEO\'s non-ISO timestamp format to real ISO on created_at', async () => {
    taskFindUnique.mockResolvedValue(OWN_TASK_ROW);
    await processDataForSeoReviewsPostback(taskPayload({
      result: [{ items: [{
        review_text: 'שירות מעולה, ממליץ בחום', rating: { value: 5 }, review_id: 'rev1',
        profile_name: 'דני', timestamp: '2026-08-14 09:23:18 +00:00',
      }] }],
    }));

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ created_at: '2026-08-14T09:23:18.000Z' }),
    }));
  });

  test('falls back to now() when timestamp is missing or unparseable', async () => {
    taskFindUnique.mockResolvedValue(OWN_TASK_ROW);
    await processDataForSeoReviewsPostback(taskPayload({
      result: [{ items: [{ review_text: 'שירות מעולה, ממליץ בחום', rating: { value: 5 }, review_id: 'rev1' }] }],
    }));

    const createdAt = reviewCreate.mock.calls[0][0].data.created_at;
    expect(new Date(createdAt).getTime()).not.toBeNaN();
  });

  test('marks the task errored on a failing status_code without writing reviews', async () => {
    taskFindUnique.mockResolvedValue(OWN_TASK_ROW);
    await processDataForSeoReviewsPostback(taskPayload({ status_code: 40000, status_message: 'Bad Request' }));

    expect(reviewCreate).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'error', error_message: 'Bad Request' }),
    }));
    expect(writeAutomationLog).toHaveBeenCalledWith('collectReviews', 'bp1', expect.any(String), 0, 'failed', expect.stringContaining('40000'), 0.01);
  });

  test('own-business happy path: creates reviews and runs the full side-effect pipeline', async () => {
    taskFindUnique.mockResolvedValue(OWN_TASK_ROW);
    await processDataForSeoReviewsPostback(taskPayload());

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platform: 'Google', linked_business: 'bp1', response_status: 'pending',
        source_origin: 'dataforseo_google_reviews', google_review_id: 'rev1',
      }),
    }));
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'complete', new_reviews_count: 1 }),
    }));
    expect(detectCompetitorMentions).toHaveBeenCalledWith('bp1', expect.any(String));
    expect(createNegativeReviewAlerts).toHaveBeenCalledWith('bp1');
    expect(publishNewReviewEvents).toHaveBeenCalledWith('bp1', expect.any(String), expect.objectContaining({ source: 'dataforseo_postback' }));
    expect(snapshotRatingHistory).toHaveBeenCalledWith('bp1', 1, 'dataforseo_postback');
    expect(backfillTopicsFor).toHaveBeenCalledWith({ linked_business: 'bp1' }, {});
  });

  test('competitor happy path: creates reviews with null response_status, only backfills topics', async () => {
    taskFindUnique.mockResolvedValue(COMPETITOR_TASK_ROW);
    await processDataForSeoReviewsPostback({
      tasks: [{
        id: 'task456', status_code: 20000, cost: 0.01,
        result: [{ items: [{ review_text: 'לא מרוצה בכלל מהשירות', rating: { value: 1 }, review_id: 'rev2' }] }],
      }],
    });

    expect(reviewCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ linked_competitor: 'comp1', response_status: null }),
    }));
    expect(backfillTopicsFor).toHaveBeenCalledWith({ linked_competitor: 'comp1' }, {});
    expect(detectCompetitorMentions).not.toHaveBeenCalled();
    expect(createNegativeReviewAlerts).not.toHaveBeenCalled();
    expect(publishNewReviewEvents).not.toHaveBeenCalled();
    expect(snapshotRatingHistory).not.toHaveBeenCalled();
  });

  test('skips items already deduped by google_review_id', async () => {
    taskFindUnique.mockResolvedValue(OWN_TASK_ROW);
    reviewFindMany.mockResolvedValue([{ google_review_id: 'rev1', text: 'שירות מעולה, ממליץ בחום' }]);

    await processDataForSeoReviewsPostback(taskPayload());

    expect(reviewCreate).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ new_reviews_count: 0 }),
    }));
  });

  test('concatenates items across multiple result[] chunks instead of only reading result[0]', async () => {
    taskFindUnique.mockResolvedValue(OWN_TASK_ROW);
    await processDataForSeoReviewsPostback({
      tasks: [{
        id: 'task123', status_code: 20000, cost: 0.05,
        result: [
          { items: [{ review_text: 'ביקורת ראשונה בעברית', rating: { value: 5 }, review_id: 'rev1' }] },
          { items: [{ review_text: 'ביקורת שנייה בעברית', rating: { value: 4 }, review_id: 'rev2' }] },
        ],
      }],
    });

    expect(reviewCreate).toHaveBeenCalledTimes(2);
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ new_reviews_count: 2 }),
    }));
  });
});
