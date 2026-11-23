export const DEFAULT_CONTEXT_LIMIT = 1_048_576;
export const DEFAULT_OUTPUT_LIMIT = 65_536;

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

const ROUTER_PRIORITY = {
  auto: 1_000_000_000,
  fusion: 900_000_000,
};

const SLOT_PRIORITY = [
  ["claude-opus", 800_000_000],
  ["claude-sonnet", 700_000_000],
  ["claude-haiku", 600_000_000],
];

function parameterScore(text) {
  const billion = text.match(/(?:^|[^a-z0-9])e?(\d+(?:\.\d+)?)\s*b\b/);
  if (billion) return Number(billion[1]) * 1_000_000;
  const million = text.match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*m\b/);
  if (million) return Number(million[1]) * 1_000;
  return 0;
}

/** Heuristic capability score: router modes, named slots, then parameter size. */
export function modelPowerScore(model) {
  const id = model.id.toLowerCase();
  if (ROUTER_PRIORITY[id] !== undefined) return ROUTER_PRIORITY[id];

  const slot = SLOT_PRIORITY.find(([prefix]) => id.startsWith(prefix));
  if (slot) return slot[1];

  const text = `${id} ${(model.name ?? "").toLowerCase()}`;
  let score = parameterScore(text);

  if (/qwen3[._-]?(?:5|6|8)/.test(id)) score += 5_000_000;
  if (id.includes("llama-3.3")) score += 5_000_000;
  if (id.includes("gemma-4")) score += 3_000_000;
  if (id.includes("mistral")) score += 2_000_000;
  if (/\b(vl|vision)\b/.test(id)) score += 2_000_000;
  if (id.includes("coder") || id.includes("instruct")) score += 1_000_000;

  return score + model.context / 1000;
}

function comparePower(a, b) {
  return modelPowerScore(b) - modelPowerScore(a) || a.id.localeCompare(b.id);
}

/**
 * Normalize a FreeLLMAPI `/v1/models` payload (or a bare array) into a list of
 * model descriptors.
 *
 * Entries marked `available: false` are skipped unless `includeUnavailable` is
 * set. Entries without an availability flag are kept, because not every
 * FreeLLMAPI build reports one. By default the result is sorted so the most
 * capable models come first.
 */
export function discoverModels(payload, { includeUnavailable = false, sortByPower = true } = {}) {
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

  if (sortByPower) models.sort(comparePower);
  return models;
}

export async function fetchModels(
  baseURL,
  apiKey,
  { timeoutMs = 10_000, fetchImpl = fetch, includeUnavailable = false, sortByPower = true } = {},
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
    return discoverModels(await response.json(), { includeUnavailable, sortByPower });
  } catch {
    return [];
  }
}

export const UNAVAILABLE_LABEL = {
  no_key: "no provider key",
  unavailable: "unavailable",
};
