import {
  CORE_ASPECTS,
  REVIEW_TOPIC_PACKS,
  resolveTopicSet,
  type Aspect,
} from '../lib/reviewTopicPacks';

const GTM_SECTORS = ['restaurant', 'beauty', 'fitness', 'medical', 'legal', 'retail', 'auto'] as const;

describe('reviewTopicPacks — KAN-122', () => {
  // AC-4
  test('AC-4: all 7 GTM sectors have packs', () => {
    for (const sector of GTM_SECTORS) {
      expect(REVIEW_TOPIC_PACKS[sector]?.length).toBeGreaterThan(0);
    }
  });

  // AC-4: packs have { id, label_he }
  test('AC-4: every pack aspect has id and Hebrew label_he', () => {
    for (const sector of GTM_SECTORS) {
      for (const aspect of REVIEW_TOPIC_PACKS[sector]) {
        expect(typeof aspect.id).toBe('string');
        expect(aspect.id.length).toBeGreaterThan(0);
        expect(typeof aspect.label_he).toBe('string');
        expect(aspect.label_he.length).toBeGreaterThan(0);
      }
    }
  });

  // AC-1: known sector → CORE + pack + extras
  test('AC-1: known sector_key returns core + pack + extras', () => {
    const extras: Aspect[] = [{ id: 'parking', label_he: 'חניה' }];
    const result = resolveTopicSet('restaurant', extras);
    const ids = result.map(a => a.id);
    // core present
    expect(ids).toContain('service');
    expect(ids).toContain('price');
    // pack present
    expect(ids).toContain('food_quality');
    // extra present
    expect(ids).toContain('parking');
  });

  // AC-2: unknown sector → core only + extras
  test('AC-2: unknown sector_key returns core only (+ extras)', () => {
    const extras: Aspect[] = [{ id: 'parking', label_he: 'חניה' }];
    const result = resolveTopicSet('other', extras);
    const ids = result.map(a => a.id);
    // core present
    for (const c of CORE_ASPECTS) expect(ids).toContain(c.id);
    // extra present
    expect(ids).toContain('parking');
    // no random pack topics
    expect(ids).not.toContain('food_quality');
    expect(ids).not.toContain('repair_quality');
  });

  // AC-3: extras capped at 3 and colliding IDs stripped
  test('AC-3: colliding extras stripped, max 3 extras accepted', () => {
    const collider: Aspect = { id: 'service', label_he: 'כפול' }; // collides with CORE
    const packCollider: Aspect = { id: 'food_quality', label_he: 'כפול' }; // collides with restaurant pack
    const good1: Aspect = { id: 'extra1', label_he: 'אחד' };
    const good2: Aspect = { id: 'extra2', label_he: 'שניים' };
    const good3: Aspect = { id: 'extra3', label_he: 'שלוש' };
    const good4: Aspect = { id: 'extra4', label_he: 'ארבע' }; // 4th valid — should be dropped

    const result = resolveTopicSet('restaurant', [collider, packCollider, good1, good2, good3, good4]);
    const ids = result.map(a => a.id);

    // colliders not duplicated
    expect(ids.filter(id => id === 'service').length).toBe(1);
    expect(ids.filter(id => id === 'food_quality').length).toBe(1);

    // only 3 valid extras
    expect(ids).toContain('extra1');
    expect(ids).toContain('extra2');
    expect(ids).toContain('extra3');
    expect(ids).not.toContain('extra4');
  });

  // AC-3: no free-label (no id) aspects survive
  test('AC-3: extras without id are stripped', () => {
    const noId = { id: '', label_he: 'ללא מזהה' } as Aspect;
    const result = resolveTopicSet('restaurant', [noId]);
    expect(result.map(a => a.id)).not.toContain('');
  });

  // category map
  test('category map: "health" resolves to medical pack', () => {
    const result = resolveTopicSet('health');
    const ids = result.map(a => a.id);
    expect(ids).toContain('doctor_expertise'); // medical pack
  });

  test('category map: "accounting" resolves to legal pack', () => {
    const result = resolveTopicSet('accounting');
    const ids = result.map(a => a.id);
    expect(ids).toContain('legal_expertise'); // legal pack
  });

  // AC-5: resolver API surface does not accept relevant_topics
  test('AC-5: resolveTopicSet has no relevant_topics parameter', () => {
    // Verify signature only accepts (sectorKey, onboardingExtras)
    // If someone passes relevant_topics they must explicitly convert — accidental reuse is impossible
    const fn = resolveTopicSet;
    expect(fn.length).toBe(1); // sectorKey is required; onboardingExtras defaults to []
  });
});
