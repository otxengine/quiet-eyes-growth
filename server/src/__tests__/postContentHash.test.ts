import { postContentHash } from '../lib/postContentHash';

test('caption-less posts get a null hash (never collide with each other)', () => {
  expect(postContentHash('instagram', null, '2026-08-10T10:00:00.000Z')).toBeNull();
  expect(postContentHash('instagram', '   ', '2026-08-10T10:00:00.000Z')).toBeNull();
});

test('same caption + same day (different time) hashes the same', () => {
  const a = postContentHash('instagram', 'Big sale this weekend!', '2026-08-10T08:00:00.000Z');
  const b = postContentHash('instagram', 'Big sale this weekend!', '2026-08-10T22:15:00.000Z');
  expect(a).not.toBeNull();
  expect(a).toBe(b);
});

test('caption whitespace/case differences still hash the same', () => {
  const a = postContentHash('facebook', '  Big Sale   This Weekend!  ', '2026-08-10T08:00:00.000Z');
  const b = postContentHash('facebook', 'big sale this weekend!', '2026-08-10T08:00:00.000Z');
  expect(a).toBe(b);
});

test('different day produces a different hash', () => {
  const a = postContentHash('instagram', 'Same caption', '2026-08-10T08:00:00.000Z');
  const b = postContentHash('instagram', 'Same caption', '2026-08-11T08:00:00.000Z');
  expect(a).not.toBe(b);
});

test('different platform produces a different hash for the same caption+day', () => {
  const a = postContentHash('instagram', 'Same caption', '2026-08-10T08:00:00.000Z');
  const b = postContentHash('facebook', 'Same caption', '2026-08-10T08:00:00.000Z');
  expect(a).not.toBe(b);
});
