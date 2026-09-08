import { describe, expect, it } from "vitest";
import {
  OVERHEAD_CLEARANCE_PX,
  buildChatAttentionByLayerId,
  resolveOverheadKind,
} from "./chatAttention";
import type { Conversation } from "../../services/chat/types";

function conv(over: Partial<Conversation> & { id: string; participantIds: string[] }): Conversation {
  return { lastMessageAt: "2026-09-08T00:00:00Z", ...over };
}

const SELF = "me@offshorly.com";

describe("buildChatAttentionByLayerId", () => {
  it("maps an unread DM onto the peer's lowercased-email layer id", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [
        conv({ id: "c1", participantIds: [SELF, "Peer@Offshorly.com"], type: "dm", unreadCount: 3 }),
      ],
      selfEmail: SELF,
      selfLayerId: "bon",
    });
    expect(map).toEqual({ "peer@offshorly.com": { conversationId: "c1", count: 3 } });
  });

  it("ignores conversations with no unread messages", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [
        conv({ id: "c1", participantIds: [SELF, "peer@offshorly.com"], type: "dm", unreadCount: 0 }),
        conv({ id: "c2", participantIds: [SELF, "other@offshorly.com"], type: "dm" }),
      ],
      selfEmail: SELF,
    });
    expect(map).toEqual({});
  });

  it("ignores group conversations (no single sender to float above)", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [
        conv({
          id: "g1",
          participantIds: [SELF, "a@offshorly.com", "b@offshorly.com"],
          type: "group",
          unreadCount: 5,
        }),
      ],
      selfEmail: SELF,
    });
    expect(map).toEqual({});
  });

  it("treats a missing type as a DM", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [conv({ id: "c1", participantIds: [SELF, "peer@offshorly.com"], unreadCount: 1 })],
      selfEmail: SELF,
    });
    expect(map["peer@offshorly.com"]).toEqual({ conversationId: "c1", count: 1 });
  });

  it("never emits an entry for the viewer — by email or by layer id", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [
        // Degenerate self-only row.
        conv({ id: "c1", participantIds: [SELF], type: "dm", unreadCount: 4 }),
        // A row whose "peer" is the viewer's rendered layer id.
        conv({ id: "c2", participantIds: [SELF, "bon"], type: "dm", unreadCount: 2 }),
      ],
      selfEmail: SELF,
      selfLayerId: "Bon",
    });
    expect(map).toEqual({});
  });

  it("collapses several unread DMs with the same coworker into ONE indicator", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [
        conv({ id: "c2", participantIds: [SELF, "peer@offshorly.com"], type: "dm", unreadCount: 2 }),
        conv({ id: "c1", participantIds: [SELF, "peer@offshorly.com"], type: "dm", unreadCount: 5 }),
      ],
      selfEmail: SELF,
    });
    expect(Object.keys(map)).toEqual(["peer@offshorly.com"]);
    // Deterministic conversation pick regardless of row order.
    expect(map["peer@offshorly.com"]).toEqual({ conversationId: "c1", count: 7 });
  });

  it("keeps one entry per coworker across several coworkers", () => {
    const map = buildChatAttentionByLayerId({
      conversations: [
        conv({ id: "c1", participantIds: [SELF, "a@offshorly.com"], type: "dm", unreadCount: 1 }),
        conv({ id: "c2", participantIds: [SELF, "b@offshorly.com"], type: "dm", unreadCount: 9 }),
      ],
      selfEmail: SELF,
    });
    expect(Object.keys(map).sort()).toEqual(["a@offshorly.com", "b@offshorly.com"]);
  });
});

describe("resolveOverheadKind", () => {
  const base = { isGreeted: false, sentText: undefined, isTyping: false, hasStatus: false };

  it("follows OfficeStage's greeting > sentText > typing > status > none priority", () => {
    expect(resolveOverheadKind({ ...base, isGreeted: true, sentText: "hi", isTyping: true, hasStatus: true })).toBe("greeting");
    expect(resolveOverheadKind({ ...base, sentText: "hi", isTyping: true, hasStatus: true })).toBe("sentText");
    expect(resolveOverheadKind({ ...base, isTyping: true, hasStatus: true })).toBe("typing");
    expect(resolveOverheadKind({ ...base, hasStatus: true })).toBe("status");
    expect(resolveOverheadKind(base)).toBe("none");
  });

  it("treats empty sent text as no bubble", () => {
    expect(resolveOverheadKind({ ...base, sentText: "", hasStatus: true })).toBe("status");
  });
});

describe("OVERHEAD_CLEARANCE_PX", () => {
  it("clears more room for the taller wrapping bubbles than for a single-line pill", () => {
    expect(OVERHEAD_CLEARANCE_PX.greeting).toBeGreaterThan(OVERHEAD_CLEARANCE_PX.status);
    expect(OVERHEAD_CLEARANCE_PX.sentText).toBeGreaterThan(OVERHEAD_CLEARANCE_PX.typing);
    expect(OVERHEAD_CLEARANCE_PX.status).toBeGreaterThan(OVERHEAD_CLEARANCE_PX.none);
  });

  it("always clears the shared 4px head gap plus the pill underneath", () => {
    for (const value of Object.values(OVERHEAD_CLEARANCE_PX)) {
      expect(value).toBeGreaterThanOrEqual(4);
    }
  });
});
