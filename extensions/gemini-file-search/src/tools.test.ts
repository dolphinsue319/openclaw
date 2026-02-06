import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(async () => ({
    apiKey: "test-api-key",
    source: "test",
    mode: "api-key",
  })),
  requireApiKey: vi.fn(() => "test-api-key"),
}));

import * as geminiClient from "./gemini-client.js";
import { createListStoresTool } from "./list-stores-tool.js";
import { createQueryTool } from "./query-tool.js";

// oxlint-disable-next-line typescript/no-explicit-any
function fakeApi(overrides: any = {}) {
  return {
    id: "gemini-file-search",
    name: "gemini-file-search",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    ...overrides,
  };
}

function fakeCtx() {
  return { config: {}, agentDir: "/tmp/test" };
}

describe("gemini_file_search_stores tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("formats store list", async () => {
    vi.spyOn(geminiClient, "listFileSearchStores").mockResolvedValueOnce([
      { name: "fileSearchStores/abc", displayName: "API Docs", description: "Main API docs" },
      { name: "fileSearchStores/def", displayName: "Guide" },
    ]);

    const tool = createListStoresTool(fakeApi(), fakeCtx());
    const result = await tool.execute();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("API Docs");
    expect(text).toContain("fileSearchStores/abc");
    expect(text).toContain("Main API docs");
    expect(text).toContain("Guide");
  });

  it("handles empty stores", async () => {
    vi.spyOn(geminiClient, "listFileSearchStores").mockResolvedValueOnce([]);

    const tool = createListStoresTool(fakeApi(), fakeCtx());
    const result = await tool.execute();
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("No file search stores found");
  });
});

describe("gemini_file_search tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("formats answer with sources", async () => {
    vi.spyOn(geminiClient, "queryFileSearch").mockResolvedValueOnce({
      answer: "The result is here.",
      sources: [{ title: "Doc A", uri: "https://example.com/a" }],
    });

    const tool = createQueryTool(fakeApi(), fakeCtx());
    const result = await tool.execute("id", { query: "what?", stores: ["s"] });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("The result is here.");
    expect(text).toContain("**Sources:**");
    expect(text).toContain("Doc A");
    expect(text).toContain("https://example.com/a");
  });

  it("formats answer without sources", async () => {
    vi.spyOn(geminiClient, "queryFileSearch").mockResolvedValueOnce({
      answer: "Just an answer.",
      sources: [],
    });

    const tool = createQueryTool(fakeApi(), fakeCtx());
    const result = await tool.execute("id", { query: "what?", stores: ["s"] });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Just an answer.");
    expect(text).not.toContain("Sources");
  });

  it("throws on empty query", async () => {
    const tool = createQueryTool(fakeApi(), fakeCtx());
    await expect(tool.execute("id", { query: "", stores: ["s"] })).rejects.toThrow(/query/i);
  });

  it("throws on empty stores", async () => {
    const tool = createQueryTool(fakeApi(), fakeCtx());
    await expect(tool.execute("id", { query: "q", stores: [] })).rejects.toThrow(/store/i);
  });

  it("passes model override to client", async () => {
    const spy = vi.spyOn(geminiClient, "queryFileSearch").mockResolvedValueOnce({
      answer: "ok",
      sources: [],
    });

    const tool = createQueryTool(fakeApi(), fakeCtx());
    await tool.execute("id", { query: "q", stores: ["s"], model: "gemini-2.5-pro" });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-2.5-pro" }));
  });
});
