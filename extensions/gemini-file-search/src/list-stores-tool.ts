import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type { OpenClawPluginToolContext } from "../../../src/plugins/types.js";
import type { PluginCfg } from "./types.js";
import { listFileSearchStores } from "./gemini-client.js";

export function createListStoresTool(api: OpenClawPluginApi, ctx: OpenClawPluginToolContext) {
  const pluginCfg = (api.pluginConfig ?? {}) as PluginCfg;

  return {
    name: "gemini_file_search_stores",
    description:
      "List available Gemini File Search document stores. Returns store names, display names, and descriptions. Cache the result — stores rarely change within a session.",
    parameters: Type.Object({}),

    async execute() {
      const stores = await listFileSearchStores({
        config: ctx.config,
        agentDir: ctx.agentDir,
        pluginCfg,
      });

      if (stores.length === 0) {
        return { content: [{ type: "text" as const, text: "No file search stores found." }] };
      }

      const lines = stores.map((s, i) => {
        const parts = [`${i + 1}. **${s.displayName ?? s.name}**`];
        parts.push(`   name: \`${s.name}\``);
        if (s.description) {
          parts.push(`   ${s.description}`);
        }
        return parts.join("\n");
      });

      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    },
  };
}
