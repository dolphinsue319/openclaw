import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import type { PluginCfg } from "./types.js";
import { queryFileSearch } from "./gemini-client.js";

export function createQueryTool(api: OpenClawPluginApi, ctx: OpenClawPluginToolContext) {
  const pluginCfg = (api.pluginConfig ?? {}) as PluginCfg;

  return {
    name: "gemini_file_search",
    description:
      "Search document stores using Gemini File Search. Returns an AI-generated answer grounded in the documents, along with source citations. Use gemini_file_search_stores first to discover available store names.",
    parameters: Type.Object({
      query: Type.String({ description: "Semantic search query." }),
      stores: Type.Array(Type.String(), {
        description:
          'Store names to search. Accepts full resource names ("fileSearchStores/xxx") or short IDs ("xxx").',
      }),
      model: Type.Optional(
        Type.String({ description: "Gemini model override (default: gemini-2.5-flash)." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      if (!query) {
        throw new Error("query is required");
      }

      const stores = Array.isArray(params.stores) ? (params.stores as string[]) : [];
      if (stores.length === 0) {
        throw new Error("at least one store is required");
      }

      const model = typeof params.model === "string" ? params.model.trim() || undefined : undefined;

      const result = await queryFileSearch({
        query,
        stores,
        model,
        config: ctx.config,
        agentDir: ctx.agentDir,
        pluginCfg,
      });

      const parts: string[] = [];

      if (result.answer) {
        parts.push(result.answer);
      } else {
        parts.push("No answer was generated for this query.");
      }

      if (result.sources.length > 0) {
        parts.push("");
        parts.push("**Sources:**");
        result.sources.forEach((s, i) => {
          const label = s.title || s.uri || "unknown";
          if (s.uri) {
            parts.push(`${i + 1}. [${label}](${s.uri})`);
          } else {
            parts.push(`${i + 1}. ${label}`);
          }
        });
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  };
}
