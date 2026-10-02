import { ApiError } from '../utils/http.js';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
export const aiConfig = () => ({
  configured: Boolean(process.env.OPENROUTER_API_KEY),
  provider: 'openrouter' as const,
  model: process.env.OPENROUTER_MODEL || 'openrouter/free',
});

function parseJsonContent(content: string) {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = cleaned.indexOf('{');
  if (start < 0)
    throw new ApiError(
      502,
      'OpenRouter returned an invalid structured response',
    );
  let depth = 0,
    inString = false,
    escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, index + 1));
      } catch {
        break;
      }
    }
  }
  throw new ApiError(502, 'OpenRouter returned an invalid structured response');
}

async function requestJson(system: string, data: unknown, model: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
        'X-Title': 'LeadCRM',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        // openrouter/free picks a random free model per request, and small ones ignore "return JSON" in the prompt.
        // Asking for JSON mode and requiring the parameter limits routing to models that honour it.
        response_format: { type: 'json_object' },
        provider: { require_parameters: true },
        messages: [
          {
            role: 'system',
            content: `${system}
Use only the supplied CRM JSON. Never invent facts. Return valid JSON only.`,
          },
          { role: 'user', content: JSON.stringify(data) },
        ],
      }),
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new ApiError(
          429,
          'The free AI limit has been reached. Try again later.',
        );
      const detail: any = await response.json().catch(() => ({}));
      throw new ApiError(
        502,
        `OpenRouter could not complete this request${detail?.error?.message ? `: ${detail.error.message}` : ''}`,
      );
    }
    const body: any = await response.json();
    const raw = body?.choices?.[0]?.message?.content;
    const content =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.map((part: any) => part?.text ?? '').join('')
          : '';
    if (!content)
      throw new ApiError(502, 'OpenRouter returned an empty response');
    return parseJsonContent(content);
  } catch (error: any) {
    if (error?.name === 'AbortError')
      throw new ApiError(504, 'OpenRouter timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const ATTEMPTS = 3;
/**
 * Returns the model's JSON reply. Free models occasionally answer with prose, an empty response, or JSON missing the
 * requested fields (e.g. {"":""}), so those are retried; `isValid` says whether a parsed reply has the right shape.
 */
export async function generateGroundedJson(
  system: string,
  data: unknown,
  isValid: (result: any) => boolean = () => true,
) {
  const config = aiConfig();
  if (!config.configured)
    throw new ApiError(503, 'OpenRouter is not configured');
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const result = await requestJson(system, data, config.model);
      if (isValid(result)) return result;
    } catch (error) {
      // Rate limits, timeouts and HTTP errors will not improve on an immediate retry.
      if (
        !(error instanceof ApiError) ||
        error.status !== 502 ||
        error.message.startsWith('OpenRouter could not complete')
      )
        throw error;
    }
  }
  throw new ApiError(
    502,
    `The AI model gave an unusable answer ${ATTEMPTS} times. Please try again.`,
  );
}
