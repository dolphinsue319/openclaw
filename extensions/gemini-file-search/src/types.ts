// Shared types and constants for the Gemini File Search plugin.

export type PluginCfg = {
  defaultModel?: string;
  maxStoresPerQuery?: number;
  timeoutMs?: number;
};

export const DEFAULT_MODEL = "gemini-2.5-flash";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_STORES_HARD_LIMIT = 5;
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// -- Gemini API response types --

export type FileSearchStore = {
  name: string;
  displayName?: string;
  description?: string;
};

export type ListStoresResponse = {
  fileSearchStores?: FileSearchStore[];
};

export type GroundingChunk = {
  retrievedContext?: {
    uri?: string;
    title?: string;
  };
};

export type GroundingMetadata = {
  groundingChunks?: GroundingChunk[];
};

export type ContentPart = {
  text?: string;
};

export type ContentCandidate = {
  content?: {
    parts?: ContentPart[];
  };
  groundingMetadata?: GroundingMetadata;
};

export type GenerateContentResponse = {
  candidates?: ContentCandidate[];
};
