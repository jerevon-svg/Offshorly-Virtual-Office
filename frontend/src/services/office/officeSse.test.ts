import { describe, expect, it } from "vitest";
import {
  mergePresenceRow,
  parseOfficeSseEvent,
  parsePresenceSseEvent,
  payloadFromFrame,
  splitSseFrames,
} from "./officeSse";
import type { Presence } from "./types";

function presenceRow(overrides: Partial<Presence> = {}): Presence {
  return {
    user_email: "bon@offshorly.com",
    full_name: "Bon",
    photo_url: null,
    job_title: null,
    department_name: "Dev",
    status: "ONLINE",
    source: "cliq",
    current_room_id: null,
    avatar_x: null,
    avatar_y: null,
    checked_in_at: null,
    last_seen_at: null,
    current_activity: null,
    ...overrides,
  };
}

describe("parseOfficeSseEvent", () => {
  it("unwraps the presence envelope", () => {
    // The bug this guards: parsing the raw payload AS a presence row
    // leaves user_email undefined, so every event appends a junk row and
    // the floor drifts from reality without ever correcting itself.
    const raw = JSON.stringify({
      type: "presence_update",
      presence: presenceRow(),
    });
    const event = parseOfficeSseEvent(raw);
    expect(event).toEqual({ type: "presence_update", presence: presenceRow() });
  });

  it("recognises the open handshake", () => {
    expect(parseOfficeSseEvent('{"type":"connected"}')).toEqual({ type: "connected" });
  });

  it.each([
    ['{"type":"office_toast","toast":{}}', "office_toast"],
    ['{"type":"agent_update","agent":{}}', "agent_update"],
    ['{"type":"room_state","room_id":"r","surfaced":true,"heat":{}}', "room_state"],
    ['{"type":"attention_nudge","recipient_email":"a@b.c"}', "attention_nudge"],
  ])("ignores %s rather than throwing", (raw) => {
    expect(parseOfficeSseEvent(raw)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseOfficeSseEvent("{not json")).toBeNull();
  });

  it("returns null for a presence_update with no presence body", () => {
    expect(parseOfficeSseEvent('{"type":"presence_update"}')).toBeNull();
  });
});

describe("parsePresenceSseEvent", () => {
  it("returns the row for presence updates and null for everything else", () => {
    expect(
      parsePresenceSseEvent(
        JSON.stringify({ type: "presence_update", presence: presenceRow() }),
      ),
    ).toEqual(presenceRow());
    expect(parsePresenceSseEvent('{"type":"connected"}')).toBeNull();
  });
});

describe("mergePresenceRow", () => {
  it("updates in place rather than appending a duplicate", () => {
    const rows = [presenceRow({ status: "OFFLINE" })];
    const merged = mergePresenceRow(rows, presenceRow({ status: "ONLINE" }));
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("ONLINE");
  });

  it("appends someone not already in the list", () => {
    const merged = mergePresenceRow(
      [presenceRow()],
      presenceRow({ user_email: "new@offshorly.com" }),
    );
    expect(merged).toHaveLength(2);
  });

  it("matches case-insensitively", () => {
    const merged = mergePresenceRow(
      [presenceRow({ user_email: "Bon@Offshorly.com" })],
      presenceRow({ user_email: "bon@offshorly.com", status: "AWAY" }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("AWAY");
  });

  it("drops a row with no email instead of accumulating junk", () => {
    const rows = [presenceRow()];
    expect(mergePresenceRow(rows, presenceRow({ user_email: "" }))).toBe(rows);
    expect(mergePresenceRow(rows, null)).toBe(rows);
  });

  it("does not mutate the input array", () => {
    const rows = [presenceRow({ status: "OFFLINE" })];
    mergePresenceRow(rows, presenceRow({ status: "ONLINE" }));
    expect(rows[0].status).toBe("OFFLINE");
  });
});

describe("splitSseFrames", () => {
  it("returns complete frames and carries the partial remainder", () => {
    const { frames, rest } = splitSseFrames("data: a\n\ndata: b\n\ndata: par");
    expect(frames).toEqual(["data: a", "data: b"]);
    expect(rest).toBe("data: par");
  });

  it("carries everything when no frame is complete", () => {
    const { frames, rest } = splitSseFrames("data: {\"partial\"");
    expect(frames).toEqual([]);
    expect(rest).toBe('data: {"partial"');
  });

  it("leaves an empty remainder when the buffer ends on a boundary", () => {
    const { frames, rest } = splitSseFrames("data: a\n\n");
    expect(frames).toEqual(["data: a"]);
    expect(rest).toBe("");
  });

  it("survives a chunk boundary mid-JSON", () => {
    // The real failure mode: a read can split anywhere, and treating the
    // tail as a frame would throw away half an event every time.
    const first = splitSseFrames('data: {"type":"conn');
    expect(first.frames).toEqual([]);
    const second = splitSseFrames(first.rest + 'ected"}\n\n');
    expect(second.frames).toEqual(['data: {"type":"connected"}']);
  });
});

describe("payloadFromFrame", () => {
  it("extracts the data payload", () => {
    expect(payloadFromFrame('data: {"type":"connected"}')).toBe('{"type":"connected"}');
  });

  it("skips keepalive comments", () => {
    // The backend sends ": keepalive" every 30s; parsing it as data would
    // log a JSON error twice a minute for the life of the session.
    expect(payloadFromFrame(": keepalive")).toBeNull();
  });

  it("returns null for a frame with no data line", () => {
    expect(payloadFromFrame("event: ping")).toBeNull();
  });

  it("joins multi-line data fields per the SSE spec", () => {
    expect(payloadFromFrame("data: one\ndata: two")).toBe("one\ntwo");
  });
});
