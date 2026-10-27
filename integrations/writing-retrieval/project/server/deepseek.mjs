const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-flash';

export async function callDeepSeek({ apiKey, baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL, messages, fetchImpl = fetch, timeoutMs = 45_000, maxRetries = 1 }) {
  if (!apiKey) throw Object.assign(new Error('missing_key'), { code: 'MISSING_API_KEY' });
  const root = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  let endpoint;
  try {
    const url = new URL(root);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    endpoint = root.endsWith('/chat/completions') ? root : `${root}/chat/completions`;
  } catch { throw Object.assign(new Error('bad_config'), { code: 'MODEL_CONFIG_ERROR' }); }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens:8192, stream: false }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'MODEL_AUTH_ERROR' : 'MODEL_UNAVAILABLE';
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) continue;
        throw Object.assign(new Error('provider_error'), { code });
      }
      const payload = await response.json();
      if(payload?.choices?.[0]?.finish_reason && payload.choices[0].finish_reason!=='stop') throw Object.assign(new Error('incomplete_output'),{code:'INVALID_MODEL_OUTPUT'});
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('empty_output'), { code: 'INVALID_MODEL_OUTPUT' });
      let result;
      try { result = JSON.parse(content); } catch { throw Object.assign(new Error('invalid_json'), { code: 'INVALID_MODEL_OUTPUT' }); }
      if (!result || Array.isArray(result) || typeof result !== 'object') throw Object.assign(new Error('invalid_json'), { code: 'INVALID_MODEL_OUTPUT' });
      return result;
    } catch (error) {
      if (['INVALID_MODEL_OUTPUT', 'MODEL_AUTH_ERROR', 'MODEL_CONFIG_ERROR'].includes(error?.code)) throw error;
      if (controller.signal.aborted) throw Object.assign(new Error('timeout'), { code: 'MODEL_TIMEOUT' });
      if (error?.code === 'MODEL_UNAVAILABLE' && attempt >= maxRetries) throw error;
      if (attempt >= maxRetries) throw Object.assign(new Error('upstream_failed'), { code: 'MODEL_UNAVAILABLE' });
    } finally { clearTimeout(timer); }
  }
  throw Object.assign(new Error('upstream_failed'), { code: 'MODEL_UNAVAILABLE' });
}

export const DEFAULT_DEEPSEEK_BASE_URL = DEFAULT_BASE_URL;
export const DEFAULT_DEEPSEEK_MODEL = DEFAULT_MODEL;
