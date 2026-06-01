// Shared Anthropic API utility for OTXEngine agents

/** Call Claude Sonnet via Anthropic Messages API. Returns the assistant text. */
export async function callAnthropicAPI(prompt: string, maxTokens = 1024): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: { content: Array<{ type: string; text: string }> } = await res.json();
  const text = data.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Empty Anthropic response");
  return text;
}

/** Extract and parse JSON from an AI response (handles ```json ... ``` wrapping). */
export function parseAIJson<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  // Find the outermost { } or [ ] block
  const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) throw new Error(`No JSON found in AI response: ${raw.slice(0, 200)}`);
  return JSON.parse(match[1]) as T;
}

/**
 * Call Claude Vision API with an image URL + text prompt.
 * Uses multimodal message content (image_url source type).
 */
export async function callAnthropicVisionAPI(
  prompt: string,
  imageUrl: string,
  maxTokens = 1024,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: imageUrl },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic Vision API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: { content: Array<{ type: string; text: string }> } = await res.json();
  const text = data.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Empty Anthropic Vision response");
  return text;
}

/**
 * Call Gemini generative model (Flash or Pro).
 * Raw fetch — consistent with the existing fetch pattern in this file.
 */
export async function callGeminiAPI(
  prompt: string,
  maxTokens = 800,
  model = "gemini-2.5-flash",
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } =
    await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

/**
 * Call Gemini Vision API with an image URL + text prompt.
 * Fetches the image and passes it as inlineData (base64).
 */
export async function callGeminiVisionAPI(
  prompt: string,
  imageUrl: string,
  maxTokens = 400,
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Fetch image and encode as base64
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch image for vision: ${imgRes.status}`);
  const imgBytes = await imgRes.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(imgBytes)));
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: b64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini Vision API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } =
    await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini Vision response");
  return text;
}

/** Call OpenAI text-embedding-3-small. Returns 1536-dim vector. */
export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI Embeddings HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data: { data: Array<{ embedding: number[] }>; error?: { message: string } } =
    await res.json();
  if (data.error) throw new Error(`OpenAI error: ${data.error.message}`);
  const vec = data.data[0]?.embedding;
  if (!vec?.length) throw new Error("Empty embedding response from OpenAI");
  return vec;
}
