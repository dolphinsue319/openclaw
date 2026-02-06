import { createRequire } from "node:module";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type {
  FileSearchStore,
  GenerateContentResponse,
  ListStoresResponse,
  PluginCfg,
} from "./types.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  MAX_STORES_HARD_LIMIT,
} from "./types.js";

// Dynamic import helpers — src-first, dist-fallback (same pattern as llm-task).
type ResolvedProviderAuth = {
  apiKey?: string;
  profileId?: string;
  source: string;
  mode: string;
};

type ResolveApiKeyForProviderFn = (params: {
  provider: string;
  cfg?: OpenClawConfig;
  agentDir?: string;
}) => Promise<ResolvedProviderAuth>;

type RequireApiKeyFn = (auth: ResolvedProviderAuth, provider: string) => string;

let _resolveApiKeyForProvider: ResolveApiKeyForProviderFn | undefined;
let _requireApiKey: RequireApiKeyFn | undefined;

function extractModelAuth(mod: Record<string, unknown>): {
  resolveApiKeyForProvider: ResolveApiKeyForProviderFn;
  requireApiKey: RequireApiKeyFn;
} | null {
  if (
    typeof mod.resolveApiKeyForProvider === "function" &&
    typeof mod.requireApiKey === "function"
  ) {
    return {
      resolveApiKeyForProvider: mod.resolveApiKeyForProvider as ResolveApiKeyForProviderFn,
      requireApiKey: mod.requireApiKey as RequireApiKeyFn,
    };
  }
  return null;
}

async function loadModelAuth(): Promise<{
  resolveApiKeyForProvider: ResolveApiKeyForProviderFn;
  requireApiKey: RequireApiKeyFn;
}> {
  if (_resolveApiKeyForProvider && _requireApiKey) {
    return { resolveApiKeyForProvider: _resolveApiKeyForProvider, requireApiKey: _requireApiKey };
  }

  // Try relative paths first (works when plugin lives inside the monorepo)
  for (const relPath of ["../../../src/agents/model-auth.js", "../../../agents/model-auth.js"]) {
    try {
      const mod = await import(relPath);
      const result = extractModelAuth(mod);
      if (result) {
        _resolveApiKeyForProvider = result.resolveApiKeyForProvider;
        _requireApiKey = result.requireApiKey;
        return result;
      }
    } catch {
      // ignore — try next path
    }
  }

  // Fallback: resolve via openclaw package (works when plugin is in ~/.openclaw/extensions/)
  try {
    const require = createRequire(import.meta.url);
    const openclawRoot = require.resolve("openclaw").replace(/[/\\][^/\\]+$/, "");
    for (const sub of ["agents/model-auth.js", "src/agents/model-auth.js"]) {
      try {
        const mod = await import(`${openclawRoot}/${sub}`);
        const result = extractModelAuth(mod);
        if (result) {
          _resolveApiKeyForProvider = result.resolveApiKeyForProvider;
          _requireApiKey = result.requireApiKey;
          return result;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  throw new Error("Internal error: model-auth not available");
}

function resolveBaseUrl(config?: OpenClawConfig): string {
  const raw = config?.models?.providers?.google?.baseUrl?.trim();
  if (!raw) {
    return DEFAULT_BASE_URL;
  }
  // Strip trailing slashes and /openai suffix (same normalization as embeddings-gemini)
  let url = raw.replace(/\/+$/, "");
  const openAiIndex = url.indexOf("/openai");
  if (openAiIndex > -1) {
    url = url.slice(0, openAiIndex);
  }
  return url;
}

async function resolveApiKey(config?: OpenClawConfig, agentDir?: string): Promise<string> {
  const { resolveApiKeyForProvider, requireApiKey } = await loadModelAuth();
  const auth = await resolveApiKeyForProvider({ provider: "google", cfg: config, agentDir });
  return requireApiKey(auth, "google");
}

function buildHeaders(apiKey: string, config?: OpenClawConfig): Record<string, string> {
  const providerHeaders = config?.models?.providers?.google?.headers;
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    ...providerHeaders,
  };
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

export async function listFileSearchStores(params: {
  config?: OpenClawConfig;
  agentDir?: string;
  pluginCfg?: PluginCfg;
}): Promise<FileSearchStore[]> {
  const apiKey = await resolveApiKey(params.config, params.agentDir);
  const baseUrl = resolveBaseUrl(params.config);
  const headers = buildHeaders(apiKey, params.config);
  const timeoutMs = params.pluginCfg?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = `${baseUrl}/fileSearchStores?key=${encodeURIComponent(apiKey)}`;
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", headers, signal });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini listFileSearchStores failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as ListStoresResponse;
    return data.fileSearchStores ?? [];
  } finally {
    clear();
  }
}

function normalizeStoreName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith("fileSearchStores/")) {
    return trimmed;
  }
  return `fileSearchStores/${trimmed}`;
}

export async function queryFileSearch(params: {
  query: string;
  stores: string[];
  model?: string;
  config?: OpenClawConfig;
  agentDir?: string;
  pluginCfg?: PluginCfg;
}): Promise<{ answer: string; sources: Array<{ title: string; uri: string }> }> {
  const apiKey = await resolveApiKey(params.config, params.agentDir);
  const baseUrl = resolveBaseUrl(params.config);
  const headers = buildHeaders(apiKey, params.config);
  const pluginCfg = params.pluginCfg ?? {};
  const timeoutMs = pluginCfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = params.model?.trim() || pluginCfg.defaultModel?.trim() || DEFAULT_MODEL;
  const maxStores = Math.min(
    pluginCfg.maxStoresPerQuery ?? MAX_STORES_HARD_LIMIT,
    MAX_STORES_HARD_LIMIT,
  );

  const storeNames = params.stores.slice(0, maxStores).map(normalizeStoreName);
  if (storeNames.length === 0) {
    throw new Error("At least one store name is required");
  }

  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: params.query }] }],
    tools: [{ fileSearch: { fileSearchStoreNames: storeNames } }],
  };

  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`Gemini generateContent failed: ${res.status} ${payload}`);
    }
    const data = (await res.json()) as GenerateContentResponse;
    const candidate = data.candidates?.[0];
    const answer =
      candidate?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    const sources: Array<{ title: string; uri: string }> = [];
    const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      const ctx = chunk.retrievedContext;
      if (ctx?.uri || ctx?.title) {
        sources.push({
          title: ctx.title ?? ctx.uri ?? "",
          uri: ctx.uri ?? "",
        });
      }
    }

    return { answer, sources };
  } finally {
    clear();
  }
}
