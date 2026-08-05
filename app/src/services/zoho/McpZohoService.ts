import type {
  SubmitTimeLogsRequest,
  SubmitTimeLogsResult,
  ZohoProject,
  ZohoTask,
  ZohoTimeLoggingService,
} from "./types";

// Real Zoho integration via MCP. Not wired to anything yet — every method
// rejects so misconfiguration (VITE_ZOHO_INTEGRATION_MODE=mcp without a
// real backend) fails loudly instead of silently returning fake data.
export class McpZohoService implements ZohoTimeLoggingService {
  async getProjects(_employeeId: string): Promise<ZohoProject[]> {
    // TODO: implement via Zoho MCP once connected
    throw new Error("McpZohoService.getProjects is not implemented yet");
  }

  async getTasks(_employeeId: string, _projectId: string): Promise<ZohoTask[]> {
    // TODO: implement via Zoho MCP once connected
    throw new Error("McpZohoService.getTasks is not implemented yet");
  }

  async submitTimeLogs(_request: SubmitTimeLogsRequest): Promise<SubmitTimeLogsResult> {
    // TODO: implement via Zoho MCP once connected
    throw new Error("McpZohoService.submitTimeLogs is not implemented yet");
  }
}

export const mcpZohoService = new McpZohoService();
