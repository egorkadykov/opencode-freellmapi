export const DEFAULT_CONTEXT_LIMIT = 1_048_576;
export const DEFAULT_OUTPUT_LIMIT = 65_536;

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Normalize a FreeLLMAPI `/v1/models` payload (or a bare array) into a list of
 * model descriptors.
 *
 * Entries marked `available: false` are skipped unless `includeUnavailable` is
 * set. Entries without an availability flag are kept, because not every
 * FreeLLMAPI build reports one.
 */
export function discoverModels(payload, { includeUnavailable = false } = {}) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  const seen = new Set();
  const models = [];

  for (const entry of list) {
    if (!entry) continue;

    const available = entry.available !== false;
    if (!available && !includeUnavailable) continue;

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const context =
      positiveInt(entry.context_length) ??
      positiveInt(entry.context) ??
      positiveInt(entry.context_window) ??
      DEFAULT_CONTEXT_LIMIT;
    const output = Math.min(
      positiveInt(entry.max_output_tokens) ?? positiveInt(entry.max_tokens) ?? DEFAULT_OUTPUT_LIMIT,
      context,
    );

    models.push({
      id,
      name: typeof entry.name === "string" && entry.name ? entry.name : id,
      context,
      output,
      available,
      reason: available ? undefined : typeof entry.unavailable_reason === "string" ? entry.unavailable_reason : "unavailable",
    });
  }

  return models;
}

export async function fetchModels(
  baseURL,
  apiKey,
  { timeoutMs = 10_000, fetchImpl = fetch, includeUnavailable = false } = {},
) {
  if (typeof baseURL !== "string" || !baseURL) return [];
  if (typeof apiKey !== "string" || !apiKey) return [];

  const url = `${baseURL.replace(/\/+$/, "")}/models`;

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];
    return discoverModels(await response.json(), { includeUnavailable });
  } catch {
    return [];
  }
}

export const UNAVAILABLE_LABEL = {
  no_key: "no provider key",
  unavailable: "unavailable",
};
