import test from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "../server/reader/json.mjs";
import { getConfiguredProvider } from "../server/reader/providers/index.mjs";

test("extractJson parses a clean JSON object", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("extractJson strips markdown code fences", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
});

test("extractJson recovers a JSON object surrounded by commentary", () => {
  assert.deepEqual(extractJson('Sure, here you go:\n{"a":1}\nHope that helps!'), { a: 1 });
});

test("extractJson throws a clear error when there is no JSON object at all", () => {
  assert.throws(() => extractJson("no json here"), /No JSON object found/);
});

test("getConfiguredProvider returns null when LLM_PROVIDER or LLM_API_KEY is missing", () => {
  assert.equal(getConfiguredProvider({}), null);
  assert.equal(getConfiguredProvider({ LLM_PROVIDER: "openai" }), null);
  assert.equal(getConfiguredProvider({ LLM_API_KEY: "x" }), null);
});

test("getConfiguredProvider rejects an unknown provider name", () => {
  assert.throws(() => getConfiguredProvider({ LLM_PROVIDER: "not-a-real-provider", LLM_API_KEY: "x" }), /Unknown LLM_PROVIDER/);
});

test("getConfiguredProvider accepts every documented provider alias", () => {
  for (const name of ["anthropic", "openai", "openai-compatible", "groq", "gemini"]) {
    assert.equal(typeof getConfiguredProvider({ LLM_PROVIDER: name, LLM_API_KEY: "x" }), "function");
  }
});
