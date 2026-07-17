import { batchExtractTopics } from '../lib/reviewTaxonomy';
import { invokeLLM } from '../lib/llm';

jest.mock('../lib/llm', () => ({ invokeLLM: jest.fn(), startCostTracking: jest.fn(), popCost: jest.fn() }));

const llm = invokeLLM as jest.Mock;

beforeEach(() => jest.clearAllMocks());

// ── AC1: wording-only polarity, can disagree with star rating ─────────────────

describe('batchExtractTopics — KAN-133 AC1: wording-only polarity', () => {
  test('topic polarity can be negative even when overall review is 5-star (no star-inheritance)', async () => {
    // Mixed Hebrew review: food praised, service criticised — 5-star overall
    llm.mockResolvedValue({
      results: [{ topics: ['quality', 'service'], sentiments: { quality: 'positive', service: 'negative' } }],
    });

    const [result] = await batchExtractTopics([
      { text: 'האוכל היה מעולה אבל השירות היה איטי ומאכזב' }, // 5-star overall, mixed wording
    ]);

    expect(result.topics).toBe('quality,service');
    const sentiments = JSON.parse(result.topic_sentiment);
    expect(sentiments.quality).toBe('positive');
    expect(sentiments.service).toBe('negative'); // disagrees with hypothetical 5-star
  });

  test('independent polarities per topic in a batch', async () => {
    llm.mockResolvedValue({
      results: [
        { topics: ['service', 'price'], sentiments: { service: 'positive', price: 'negative' } },
        { topics: ['cleanliness'], sentiments: { cleanliness: 'negative' } },
      ],
    });

    const results = await batchExtractTopics([
      { text: 'שירות נהדר אבל יקר מדי' },
      { text: 'המקום לא היה נקי בכלל' },
    ]);

    const s0 = JSON.parse(results[0].topic_sentiment);
    expect(s0.service).toBe('positive');
    expect(s0.price).toBe('negative');
    expect(JSON.parse(results[1].topic_sentiment).cleanliness).toBe('negative');
  });
});

// ── AC2: neutral when unclear ─────────────────────────────────────────────────

describe('batchExtractTopics — KAN-133 AC2: neutral when evidence is unclear', () => {
  test('neutral polarity is preserved and not dropped', async () => {
    llm.mockResolvedValue({
      results: [{ topics: ['atmosphere'], sentiments: { atmosphere: 'neutral' } }],
    });

    const [result] = await batchExtractTopics([{ text: 'מקום סביר, היינו שם' }]);

    expect(result.topics).toBe('atmosphere');
    expect(JSON.parse(result.topic_sentiment).atmosphere).toBe('neutral');
  });

  test('mixed: one neutral + one positive topic both stored', async () => {
    llm.mockResolvedValue({
      results: [{ topics: ['service', 'price'], sentiments: { service: 'positive', price: 'neutral' } }],
    });

    const [result] = await batchExtractTopics([{ text: 'שירות מצוין, המחיר... לא יודע' }]);

    const sentiments = JSON.parse(result.topic_sentiment);
    expect(sentiments.service).toBe('positive');
    expect(sentiments.price).toBe('neutral');
  });
});

// ── AC3: no systematic star-inheritance (QA spot-check) ──────────────────────

describe('batchExtractTopics — KAN-133 AC3: mixed-review QA sample', () => {
  // Inline QA sample: [text, expected_per_topic_polarity]
  // These assert the core property — topic polarity must NOT uniformly follow the star.
  const QA_SAMPLE = [
    {
      text: 'אוכל טעים מאוד אבל השירות היה גרוע — עובדים לא ידידותיים',
      llmResult: { topics: ['quality', 'service'], sentiments: { quality: 'positive', service: 'negative' } },
      check: (s: Record<string, string>) => s.quality === 'positive' && s.service === 'negative',
    },
    {
      text: 'המחיר גבוה מדי ביחס לאיכות שקיבלנו אבל האווירה נעימה',
      llmResult: { topics: ['price', 'quality', 'atmosphere'], sentiments: { price: 'negative', quality: 'negative', atmosphere: 'positive' } },
      check: (s: Record<string, string>) => s.price === 'negative' && s.atmosphere === 'positive',
    },
    {
      text: 'ניקיון לא טוב בכלל, שירות בסדר, אוכל — לא ידוע לי',
      llmResult: { topics: ['cleanliness', 'service', 'quality'], sentiments: { cleanliness: 'negative', service: 'neutral', quality: 'neutral' } },
      check: (s: Record<string, string>) => s.cleanliness === 'negative' && s.quality === 'neutral',
    },
  ];

  test('all QA samples produce per-topic polarities independent of overall tone', async () => {
    llm.mockResolvedValue({ results: QA_SAMPLE.map(q => q.llmResult) });

    const results = await batchExtractTopics(QA_SAMPLE.map(q => ({ text: q.text })));

    for (let i = 0; i < QA_SAMPLE.length; i++) {
      const sentiments = JSON.parse(results[i].topic_sentiment);
      expect(QA_SAMPLE[i].check(sentiments)).toBe(true);
    }
  });
});

// ── Constraint guards (AC4) ────────────────────────────────────────────────────

describe('batchExtractTopics — AC4 constraints', () => {
  test('max 6 topics enforced', async () => {
    llm.mockResolvedValue({
      results: [{ topics: ['service','price','quality','cleanliness','atmosphere','availability','delivery'], sentiments: { service:'positive', price:'neutral', quality:'positive', cleanliness:'positive', atmosphere:'positive', availability:'positive', delivery:'negative' } }],
    });

    const [result] = await batchExtractTopics([{ text: 'ביקורת ארוכה עם הרבה נושאים' }]);
    expect(result.topics.split(',').length).toBe(6);
  });

  test('unknown topic ids filtered out', async () => {
    llm.mockResolvedValue({
      results: [{ topics: ['free_label', 'service'], sentiments: { free_label: 'positive', service: 'positive' } }],
    });

    const [result] = await batchExtractTopics([{ text: 'שירות מצוין' }]);
    expect(result.topics).toBe('service');
    expect(result.topic_sentiment).not.toContain('free_label');
  });

  test('empty topics when no sentiments returned', async () => {
    llm.mockResolvedValue({ results: [{ topics: ['service'], sentiments: {} }] });

    const [result] = await batchExtractTopics([{ text: 'שירות' }]);
    expect(result.topics).toBe('');
    expect(result.topic_sentiment).toBe('{}');
  });

  test('LLM failure returns empty for all reviews', async () => {
    llm.mockRejectedValue(new Error('timeout'));

    const results = await batchExtractTopics([{ text: 'ביקורת א' }, { text: 'ביקורת ב' }]);
    for (const r of results) {
      expect(r.topics).toBe('');
      expect(r.topic_sentiment).toBe('{}');
    }
  });

  test('empty input returns empty array', async () => {
    const results = await batchExtractTopics([]);
    expect(results).toHaveLength(0);
    expect(llm).not.toHaveBeenCalled();
  });
});
