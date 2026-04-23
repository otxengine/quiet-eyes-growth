// Anthropic Claude API helper — shared across functions
// Requires ANTHROPIC_API_KEY environment variable

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const CLAUDE_MODEL = 'claude-sonnet-4-5';

export interface ClaudeOptions {
  maxTokens?: number;
  systemPrompt?: string;
  prefill?: string; // Prefill assistant turn for JSON mode
}

/**
 * Call Claude API with a prompt. Returns the response text.
 * Falls back to null if API key is missing or call fails.
 */
export async function callClaude(prompt: string, options: ClaudeOptions = {}): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const { maxTokens = 4096, systemPrompt, prefill } = options;

  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: prompt },
  ];

  // Prefill assistant turn for reliable JSON output
  if (prefill) {
    messages.push({ role: 'assistant', content: prefill });
  }

  const body: Record<string, any> = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err}`);
    }

    const data = await res.json();
    // When using prefill, prepend it back to reconstruct the full JSON
    const text = data.content?.[0]?.text || '';
    return prefill ? prefill + text : text;
  } catch (err) {
    console.error('callClaude error:', err.message);
    return null;
  }
}

/**
 * Parse JSON from Claude response text, with robust extraction.
 * Returns parsed object or fallback value on failure.
 */
export function parseClaudeJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    // Try direct parse first
    return JSON.parse(text) as T;
  } catch (_) {}

  // Extract first JSON object or array
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch (_) {}
  }

  return fallback;
}
