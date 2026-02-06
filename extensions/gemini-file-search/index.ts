import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createListStoresTool } from "./src/list-stores-tool.js";
import { createQueryTool } from "./src/query-tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool((ctx) => [createListStoresTool(api, ctx), createQueryTool(api, ctx)], {
    optional: true,
  });
}
