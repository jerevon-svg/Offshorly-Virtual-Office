import { HrIntegrationPendingError, type HrAvailability, type HrCapability, type HrLeaveService } from "./types";

export * from "./types";

// THE ONLY IMPLEMENTATION TODAY. Atlas has no employee-scoped leave endpoints yet (see
// ATLAS_HR_LEAVE_ENDPOINT_REQUEST.md), and its existing leave routes are all-employee reporting
// routes the browser must never call. So every capability reports itself unavailable and every call
// rejects — the HR Desk shows its pending state rather than invented data. An Atlas-backed
// implementation replaces this once the contract is agreed; there is deliberately no mock mode.
export class PendingHrLeaveService implements HrLeaveService {
  availability(_capability: HrCapability): HrAvailability {
    return { state: "unavailable", reason: "integration-pending" };
  }
  listLeaveTypes(): Promise<never> {
    return Promise.reject(new HrIntegrationPendingError("leaveTypes"));
  }
  getLeaveBalance(): Promise<never> {
    return Promise.reject(new HrIntegrationPendingError("leaveBalance"));
  }
  listLeaveRequests(): Promise<never> {
    return Promise.reject(new HrIntegrationPendingError("leaveRequests"));
  }
  submitLeaveRequest(): Promise<never> {
    return Promise.reject(new HrIntegrationPendingError("submitLeave"));
  }
}

export const hrLeaveService: HrLeaveService = new PendingHrLeaveService();
