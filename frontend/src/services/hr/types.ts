// HR Services — the leave data the HR Desk shows, shaped after the PROPOSED Atlas contract in
// ATLAS_HR_LEAVE_ENDPOINT_REQUEST.md. None of these routes exist yet; nothing here claims they do.
//
// Zoho People is the authority for every field. The employee is never a parameter: Atlas resolves
// "who is asking" from the caller's bearer token, so no method below takes an employee id.

export type HrCapability = "leaveTypes" | "leaveBalance" | "leaveRequests" | "submitLeave";

/** Whether a capability is backed by a verified, employee-scoped endpoint. */
export type HrAvailability =
  | { state: "available" }
  | { state: "unavailable"; reason: "integration-pending" };

export interface LeaveType {
  id: string;
  name: string;
  /** "day" or "hour" — Zoho People configures this per leave type */
  unit: "day" | "hour";
}

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  unit: "day" | "hour";
  available: number;
  used: number;
  /** absent when Zoho does not report it for this type */
  pending?: number;
}

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest {
  id: string;
  leaveTypeName: string;
  /** ISO calendar dates (YYYY-MM-DD), inclusive */
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  /** ISO timestamp */
  submittedAt: string;
  reason?: string;
}

export interface SubmitLeaveInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  /** one per submit attempt, so a retried request cannot file the leave twice */
  idempotencyKey: string;
}

export interface HrLeaveService {
  availability(capability: HrCapability): HrAvailability;
  listLeaveTypes(): Promise<LeaveType[]>;
  getLeaveBalance(): Promise<LeaveBalance[]>;
  listLeaveRequests(): Promise<LeaveRequest[]>;
  /** resolves only once Atlas confirms Zoho People accepted the request */
  submitLeaveRequest(input: SubmitLeaveInput): Promise<LeaveRequest>;
}

/** Thrown by any call whose capability is not available — the UI shows its pending state instead. */
export class HrIntegrationPendingError extends Error {
  constructor(capability: HrCapability) {
    super(`HR integration pending: ${capability}`);
    this.name = "HrIntegrationPendingError";
  }
}
