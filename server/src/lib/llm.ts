import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

export interface LLMOptions {
  response_json_schema?: any;
  model?: string; // 'haiku' | 'sonnet' | 'opus' or full model ID
}

const MODEL_MAP: Record<string, string> = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-6',
};

/**
 * Drop-in replacement for base44 InvokeLLM.
 * Returns parsed JSON if response_json_schema is provided, otherwise raw text.
 * model: 'haiku' (fast, cheap), 'sonnet' (default), 'opus' (deep analysis)
 * Automatically falls back to OpenAI GPT-4o when Anthropic fails (and vice versa).
 */
export async function invokeLLM(options: { prompt: string } & LLMOptions): Promise<any> {
  const { prompt, response_json_schema, model } = options;

  const modelId = MODEL_MAP[model || ''] || model || 'claude-sonnet-4-6';
  const maxTokens = model === 'haiku' ? 512 : 4096;

  // Try Anthropic first
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await _callAnthropic(prompt, modelId, maxTokens, response_json_schema);
    } catch (err: any) {
      console.warn('[invokeLLM] Anthropic failed, trying OpenAI fallback:', err.message);
    }
  }

  // Fallback: OpenAI GPT-4o
  if (process.env.OPENAI_API_KEY) {
    try {
      return await _callOpenAI(prompt, response_json_schema);
    } catch (err: any) {
      console.warn('[invokeLLM] OpenAI fallback also failed:', err.message);
    }
  }

  throw new Error('No AI provider available — set ANTHROPIC_API_KEY or OPENAI_API_KEY');
}

async function _callAnthropic(
  prompt: string,
  modelId: string,
  maxTokens: number,
  response_json_schema: any,
): Promise<any> {
  const systemPrompt = response_json_schema
    ? 'You are a helpful assistant. Return ONLY valid JSON. No markdown fences, no explanation, no extra text — just the JSON object.'
    : 'You are a helpful assistant.';

  // Claude 4.x does not support assistant-turn prefill.
  // We rely on the system prompt + user prompt to get JSON back directly.
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const text = (response.content[0] as any).text || '';

  if (response_json_schema) {
    return _parseJson(text);
  }
  return text;
}

async function _callOpenAI(prompt: string, response_json_schema: any): Promise<any> {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
  const messages: any[] = [
    {
      role: 'system',
      content: response_json_schema
        ? 'You are a helpful assistant. Return ONLY valid JSON. No markdown, no explanation.'
        : 'You are a helpful assistant.',
    },
    { role: 'user', content: prompt },
  ];

  const body: any = {
    model: 'gpt-4o',
    max_tokens: 4096,
    temperature: 0.3,
    messages,
  };
  if (response_json_schema) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`OpenAI GPT-4o ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data: any = await res.json();
  const text = data.choices?.[0]?.message?.content || '';

  if (response_json_schema) {
    return _parseJson(text);
  }
  return text;
}

function _parseJson(text: string): any {
  const clean = text.replace(/```json?|```/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  const arr = clean.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }
  return null;
}
