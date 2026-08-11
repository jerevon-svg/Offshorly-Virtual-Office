import { atlasZohoService } from "./AtlasZohoService";
import { mockZohoService } from "./MockZohoService";
import { mcpZohoService } from "./McpZohoService";
import type { ZohoTimeLoggingService } from "./types";

export * from "./types";
export { MockZohoService, mockZohoService } from "./MockZohoService";
export { McpZohoService, mcpZohoService } from "./McpZohoService";
export {
  AtlasZohoService,
  atlasZohoService,
  AlreadySubmittedError,
  isAlreadySubmittedError,
} from "./AtlasZohoService";

type IntegrationMode = "mock" | "mcp" | "real";

// "real" routes through Atlas's backend, which owns the Zoho OAuth
// connection. "mcp" is retained only so an old env value fails loudly
// (every McpZohoService method throws) rather than silently falling back to
// fake data. Default stays "mock".
function resolveMode(): IntegrationMode {
  const raw = import.meta.env.VITE_ZOHO_INTEGRATION_MODE;
  if (raw === "real") return "real";
  return raw === "mcp" ? "mcp" : "mock";
}

// Singleton picked once at module load based on the build-time env var.
const _mode = resolveMode();

/** True when time-logging actually reaches Zoho (via Atlas's backend).
 *  The checkout UI is gated on this: while it is false, submitting would
 *  record a day that never leaves the browser, which is worse than the
 *  feature being absent. */
export function isRealZohoMode(): boolean {
  return _mode === "real";
}
export const zohoService: ZohoTimeLoggingService =
  _mode === "real"
    ? atlasZohoService
    : _mode === "mcp"
      ? mcpZohoService
      : mockZohoService;
