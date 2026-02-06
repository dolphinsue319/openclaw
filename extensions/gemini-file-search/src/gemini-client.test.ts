import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(async () => ({
    apiKey: "test-api-key",
    source: "test",
    mode: "api-key",
  })),
  requireApiKey: vi.fn(() => "test-api-key"),
}));

import { listFileSearchStores, queryFileSearch } from "./gemini-client.js";

const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
    headers: new Headers(),
  } as Response;
}

describe("listFileSearchStores", () => {
  it("returns stores from API", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        fileSearchStores: [
          { name: "fileSearchStores/abc", displayName: "My Docs", description: "Test store" },
        ],
      }),
    );

    const stores = await listFileSearchStores({});
    expect(stores).toHaveLength(1);
    expect(stores[0]?.name).toBe("fileSearchStores/abc");
    expect(stores[0]?.displayName).toBe("My Docs");
  });

  it("returns empty array when no stores", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({}));
    const stores = await listFileSearchStores({});
    expect(stores).toEqual([]);
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "bad" }, 403));
    await expect(listFileSearchStores({})).rejects.toThrow(/403/);
  });
});

describe("queryFileSearch", () => {
  it("returns answer and sources", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "The answer is 42." }] },
            groundingMetadata: {
              groundingChunks: [
                { retrievedContext: { uri: "https://example.com/doc", title: "Doc A" } },
              ],
            },
          },
        ],
      }),
    );

    const result = await queryFileSearch({
      query: "what is the answer?",
      stores: ["my-store"],
    });

    expect(result.answer).toBe("The answer is 42.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.title).toBe("Doc A");
    expect(result.sources[0]?.uri).toBe("https://example.com/doc");
  });

  it("normalizes short store names to full resource names", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );

    await queryFileSearch({ query: "test", stores: ["short-id"] });
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(body.tools[0].fileSearch.fileSearchStoreNames).toEqual(["fileSearchStores/short-id"]);
  });

  it("passes through already-prefixed store names", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );

    await queryFileSearch({ query: "test", stores: ["fileSearchStores/full-id"] });
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(body.tools[0].fileSearch.fileSearchStoreNames).toEqual(["fileSearchStores/full-id"]);
  });

  it("uses plugin config model override", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );

    await queryFileSearch({
      query: "test",
      stores: ["s"],
      pluginCfg: { defaultModel: "gemini-2.0-pro" },
    });

    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("models/gemini-2.0-pro");
  });

  it("uses per-call model override over plugin config", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );

    await queryFileSearch({
      query: "test",
      stores: ["s"],
      model: "gemini-2.5-pro",
      pluginCfg: { defaultModel: "gemini-2.0-pro" },
    });

    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain("models/gemini-2.5-pro");
  });

  it("throws when no stores provided", async () => {
    await expect(queryFileSearch({ query: "test", stores: [] })).rejects.toThrow(
      /at least one store/i,
    );
  });

  it("throws on API error", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "quota" }, 429));
    await expect(queryFileSearch({ query: "test", stores: ["s"] })).rejects.toThrow(/429/);
  });

  it("limits stores to maxStoresPerQuery", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );

    await queryFileSearch({
      query: "test",
      stores: ["a", "b", "c", "d", "e", "f", "g"],
      pluginCfg: { maxStoresPerQuery: 3 },
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(body.tools[0].fileSearch.fileSearchStoreNames).toHaveLength(3);
  });

  it("returns empty answer when no candidates", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    const result = await queryFileSearch({ query: "test", stores: ["s"] });
    expect(result.answer).toBe("");
    expect(result.sources).toEqual([]);
  });
});
