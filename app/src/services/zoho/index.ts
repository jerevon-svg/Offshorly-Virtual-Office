import { mockZohoService } from "./MockZohoService";
import { mcpZohoService } from "./McpZohoService";
import type { ZohoTimeLoggingService } from "./types";

export * from "./types";
export { MockZohoService, mockZohoService } from "./MockZohoService";
export { McpZohoService, mcpZohoService } from "./McpZohoService";

type IntegrationMode = "mock" | "mcp";

function resolveMode(): IntegrationMode {
  const raw = import.meta.env.VITE_ZOHO_INTEGRATION_MODE;
  return raw === "mcp" ? "mcp" : "mock";
}

// Singleton picked once at module load based on the build-time env var.
export const zohoService: ZohoTimeLoggingService =
  resolveMode() === "mcp" ? mcpZohoService : mockZohoService;
