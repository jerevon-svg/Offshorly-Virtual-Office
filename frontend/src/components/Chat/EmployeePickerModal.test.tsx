import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EmployeePickerModal } from "./EmployeePickerModal";

const PEOPLE = [
  { email: "b@example.com", displayName: "Bea" },
  { email: "c@example.com", displayName: "Cal" },
];

describe("EmployeePickerModal group naming", () => {
  afterEach(cleanup);

  it("multi mode hands back the selected emails and the trimmed optional group name", () => {
    const onConfirm = vi.fn();
    render(<EmployeePickerModal mode="multi" title="New Group Chat" people={PEOPLE} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText("Bea"));
    fireEvent.click(screen.getByText("Cal"));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "  Design Team  " } });
    fireEvent.click(screen.getByText("Create Group (2)"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [emails, groupName] = onConfirm.mock.calls[0];
    expect([...emails].sort()).toEqual(["b@example.com", "c@example.com"]);
    expect(groupName).toBe("Design Team");
  });

  it("multi mode leaves the name blank when nothing was typed", () => {
    const onConfirm = vi.fn();
    render(<EmployeePickerModal mode="multi" title="New Group Chat" people={PEOPLE} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText("Bea"));
    fireEvent.click(screen.getByText("Cal"));
    fireEvent.click(screen.getByText("Create Group (2)"));

    expect(onConfirm.mock.calls[0][1]).toBe("");
  });

  it("single mode is unchanged: no name field, confirms one email on click", () => {
    const onConfirm = vi.fn();
    render(<EmployeePickerModal mode="single" title="New Message" people={PEOPLE} onClose={vi.fn()} onConfirm={onConfirm} />);

    expect(screen.queryByLabelText("Group name")).toBeNull();
    fireEvent.click(screen.getByText("Bea"));
    expect(onConfirm).toHaveBeenCalledWith(["b@example.com"]);
  });
});
