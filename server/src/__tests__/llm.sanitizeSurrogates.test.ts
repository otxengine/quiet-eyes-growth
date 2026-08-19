import { sanitizeSurrogates } from '../lib/llm';

describe('sanitizeSurrogates', () => {
  test('leaves plain text untouched', () => {
    expect(sanitizeSurrogates('hello world')).toBe('hello world');
  });

  test('preserves a valid surrogate pair (real emoji)', () => {
    const emoji = '😀'; // 😀
    expect(sanitizeSurrogates(`hi ${emoji} there`)).toBe(`hi ${emoji} there`);
  });

  test('drops a lone high surrogate with no following low surrogate', () => {
    const broken = 'hi \uD83D there';
    expect(sanitizeSurrogates(broken)).toBe('hi  there');
  });

  test('drops a lone low surrogate with no preceding high surrogate', () => {
    const broken = 'hi \uDE00 there';
    expect(sanitizeSurrogates(broken)).toBe('hi  there');
  });
});
