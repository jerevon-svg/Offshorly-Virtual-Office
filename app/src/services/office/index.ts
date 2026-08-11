import { mockOfficeService } from "./MockOfficeService";
import { realOfficeService } from "./RealOfficeService";
import type { OfficeService } from "./types";

export * from "./types";
export { MockOfficeService, mockOfficeService } from "./MockOfficeService";
export { RealOfficeService, realOfficeService } from "./RealOfficeService";

type IntegrationMode = "mock" | "real";

// Mirrors the switch in services/zoho/index.ts. Defaults to "mock" so that
// a missing env var degrades to the offline cast rather than firing
// unauthenticated requests at whatever VITE_API_URL happens to point at.
//
// Set VITE_OFFICE_INTEGRATION_MODE=real in app/.env.local (and on the
// Render static site) to talk to Atlas.
function resolveMode(): IntegrationMode {
  const raw = import.meta.env.VITE_OFFICE_INTEGRATION_MODE;
  return raw === "real" ? "real" : "mock";
}

// Singleton picked once at module load from the build-time env var — the
// same pattern as zohoService. A static bundle has no runtime env, so this
// cannot be flipped after build.
export const officeService: OfficeService =
  resolveMode() === "real" ? realOfficeService : mockOfficeService;
