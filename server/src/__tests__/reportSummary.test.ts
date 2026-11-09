jest.mock('../db', () => ({ prisma: {} }));
jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn(), startCostTracking: jest.fn(), popCost: jest.fn(() => 0) }));

import { mentionedCompetitor } from '../lib/reportData';
import { isCompleteSummary } from '../routes/functions/generateReport';

// Real tracked-competitor names from the first production weekly report (2026-11-08).
const NAMES = ['יפו-תל אביב', 'SPICEHAUS | ספייסהאוס', 'קומראן Qumran TLV', "קונסיירז'", 'George & John - Relais & Châteaux'];

describe('mentionedCompetitor', () => {
  it('drops insights about rivals the business does not track', () => {
    // These were the noise in the first real report's changes list.
    expect(mentionedCompetitor('תובנה על וילה מארה תל אביב: מחירי וילה מארה גבוהים', NAMES)).toBeNull();
    expect(mentionedCompetitor('תובנה על מסעדת פאסטל: מחירים גבוהים בחנוכה', NAMES)).toBeNull();
  });

  it('matches either half of a bilingual name, or its Hebrew run alone', () => {
    expect(mentionedCompetitor('ספייסהאוס העלתה מחירים', NAMES)).toBe('SPICEHAUS | ספייסהאוס');
    expect(mentionedCompetitor('קומראן הוסיפה תפריט חדש', NAMES)).toBe('קומראן Qumran TLV');
    expect(mentionedCompetitor('Relais & Châteaux member changed its menu', NAMES)).toBe('George & John - Relais & Châteaux');
    expect(mentionedCompetitor('קונסיירז שינתה שעות פתיחה', NAMES)).toBe("קונסיירז'");
  });

  it('keeps an unspaced hyphenated name whole', () => {
    expect(mentionedCompetitor('יפו-תל אביב השיקה מבצע', NAMES)).toBe('יפו-תל אביב');
  });
});

describe('isCompleteSummary', () => {
  const full = { headline: 'h', highlights: ['a'], reviews_summary: 'r', own_summary: 'o', recommended_actions: ['x'] };

  it('rejects the cut-off shape the first real weekly run returned', () => {
    expect(isCompleteSummary('weekly', { headline: 'h', highlights: ['a'], per_competitor: [] })).toBe(false);
  });

  it('requires the sections each report type asks for', () => {
    expect(isCompleteSummary('daily', { headline: 'h', highlights: ['a'], recommended_actions: ['x'] })).toBe(true);
    expect(isCompleteSummary('weekly', { ...full, own_summary: undefined })).toBe(true);
    expect(isCompleteSummary('weekly', { ...full, reviews_summary: undefined })).toBe(false);
    expect(isCompleteSummary('monthly', { ...full, own_summary: undefined })).toBe(false);
    expect(isCompleteSummary('monthly', full)).toBe(true);
    expect(isCompleteSummary('daily', null)).toBe(false);
  });
});
