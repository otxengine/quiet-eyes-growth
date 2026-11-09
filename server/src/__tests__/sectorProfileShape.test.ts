import { getSectorProfile, buildAgentPromptContext } from '../lib/businessProfile';

const base = { name: 'KID JEWELRY', category: 'jewelry', city: 'תל אביב' };

describe('getSectorProfile normalizes LLM-written JSON', () => {
  it('a profile missing the topic arrays no longer crashes prompt building (prod, 2026-11-09)', () => {
    const sector_profile = JSON.stringify({ sector_label_he: 'תכשיטים', sub_sector: 'kids_jewelry', content_tone: 'חם' });
    expect(() => buildAgentPromptContext({ ...base, sector_profile })).not.toThrow();
    const sp = getSectorProfile({ sector_profile })!;
    expect(sp.relevant_topics).toEqual([]);
    expect(sp.irrelevant_topics).toEqual([]);
    expect(sp.competitor_type_he).toBe('');
  });

  it('accepts comma-separated strings where arrays are expected, and arrays where text is', () => {
    const sp = getSectorProfile({ sector_profile: JSON.stringify({
      relevant_topics: 'תכשיטים, מתנות ,ילדים', competitor_type_he: ['חנויות תכשיטים', 'אתרי מתנות'],
    }) })!;
    expect(sp.relevant_topics).toEqual(['תכשיטים', 'מתנות', 'ילדים']);
    expect(sp.competitor_type_he).toBe('חנויות תכשיטים, אתרי מתנות');
  });

  it('keeps a well-formed profile intact and still rejects junk', () => {
    const good = { sector_label_he: 'מסעדה', relevant_topics: ['אוכל'], irrelevant_topics: ['נדל"ן'], service_model: ['walk_in'] };
    const sp = getSectorProfile({ sector_profile: JSON.stringify(good) })!;
    expect(sp.relevant_topics).toEqual(['אוכל']);
    expect(sp.service_model).toEqual(['walk_in']);
    expect(buildAgentPromptContext({ ...base, sector_profile: JSON.stringify(good) })).toContain('• אוכל');
    expect(getSectorProfile({ sector_profile: 'not json' })).toBeNull();
    expect(getSectorProfile({ sector_profile: 'null' })).toBeNull();
    expect(getSectorProfile({ sector_profile: null })).toBeNull();
  });
});
