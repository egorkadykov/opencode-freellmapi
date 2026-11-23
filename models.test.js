import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONTEXT_LIMIT, DEFAULT_OUTPUT_LIMIT, discoverModels, fetchModels } from "./models.js";

test("reads the OpenAI-style data array and skips unavailable models", () => {
  const models = discoverModels({
    data: [
      { id: "auto", name: "Auto", available: true, context_length: 200000 },
      { id: "retired", available: false },
      { id: "plain" },
    ],
  });

  assert.deepEqual(models.map((m) => m.id), ["auto", "plain"]);
  assert.deepEqual(models[0], {
    id: "auto",
    name: "Auto",
    context: 200000,
    output: DEFAULT_OUTPUT_LIMIT,
    available: true,
    reason: undefined,
  });
});

test("keeps entries that do not report availability", () => {
  const models = discoverModels([{ id: "no-flag" }, null, {}, { id: "" }]);
  assert.equal(models.length, 1);
  assert.equal(models[0].context, DEFAULT_CONTEXT_LIMIT);
  assert.equal(models[0].name, "no-flag");
  assert.equal(models[0].available, true);
});

test("includeUnavailable keeps entries the router marks as unavailable", () => {
  const payload = {
    data: [
      { id: "glm-5.3", name: "GLM 5.3", available: false, unavailable_reason: "no_key" },
      { id: "auto", name: "Auto", available: true },
    ],
  };

  assert.deepEqual(discoverModels(payload).map((m) => m.id), ["auto"]);

  const all = discoverModels(payload, { includeUnavailable: true });
  assert.deepEqual(all.map((m) => m.id), ["glm-5.3", "auto"]);
  assert.equal(all[0].available, false);
  assert.equal(all[0].reason, "no_key");
  assert.equal(all[1].reason, undefined);
});

test("fetchModels forwards includeUnavailable to the parser", async () => {
  const models = await fetchModels("http://127.0.0.1:3001/v1", "key", {
    includeUnavailable: true,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "x", available: false, unavailable_reason: "no_key" }] }),
    }),
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].id, "x");
});

test("deduplicates ids and caps output at the context window", () => {
  const models = discoverModels([
    { id: "dup", name: "First", context_length: 1000, max_output_tokens: 5000 },
    { id: "dup", name: "Second" },
  ]);

  assert.equal(models.length, 1);
  assert.equal(models[0].name, "First");
  assert.equal(models[0].output, 1000);
});

test("ignores non-array payloads", () => {
  assert.deepEqual(discoverModels(undefined), []);
  assert.deepEqual(discoverModels({ data: "nope" }), []);
});

test("fetchModels builds the models url and returns an empty list on failure", async () => {
  const calls = [];
  const ok = await fetchModels("http://127.0.0.1:3001/v1/", "key", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ data: [{ id: "m1", available: true }] }) };
    },
  });

  assert.equal(calls[0].url, "http://127.0.0.1:3001/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer key");
  assert.deepEqual(ok.map((m) => m.id), ["m1"]);

  const failed = await fetchModels("http://127.0.0.1:3001/v1", "key", {
    fetchImpl: async () => {
      throw new Error("down");
    },
  });
  assert.deepEqual(failed, []);

  const unauthorized = await fetchModels("http://127.0.0.1:3001/v1", "key", {
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  assert.deepEqual(unauthorized, []);
});

test("fetchModels requires both endpoint and key", async () => {
  assert.deepEqual(await fetchModels("", "key"), []);
  assert.deepEqual(await fetchModels("http://127.0.0.1:3001/v1", ""), []);
});
