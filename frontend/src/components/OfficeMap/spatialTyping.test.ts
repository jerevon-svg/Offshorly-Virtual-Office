import { describe, expect, it } from "vitest";
import { resolveCharacterAnimState } from "../../render3d/characterAnimationState";
import {
  applyPeerTypingUpdate,
  deriveAnyTypingCharacterIds,
  deriveSpatialTypingCharacterIds,
  type PeerTypingState,
} from "./spatialTyping";

const PEER = "alex@offshorly.com";
const SELF = "jerevon@offshorly.com";
const SPATIAL = "conv-spatial-1";
const REMOTE_DM = "conv-remote-dm-9";
const sessions = [{ sessionId: SPATIAL, members: [PEER, SELF] }];

// Mirrors OfficeStage's wiring: isSpatialConversation from session membership, isTyping from the
// spatial-scoped list — so these tests exercise the exact animation outcome, not just the list.
function peerAnim(peerTyping: PeerTypingState, sess = sessions) {
  const spatialTyping = deriveSpatialTypingCharacterIds({
    peerTyping,
    sessions: sess,
    selfChatId: SELF,
    playerLayerId: "bon",
    selfTypingConversationId: null,
  });
  const inConversation = sess.some((s) => s.members.length >= 2 && s.members.includes(PEER));
  return resolveCharacterAnimState({
    isWalking: false,
    isSitting: false,
    isGlobalChatActive: false,
    isSpatialConversation: inConversation,
    isTyping: spatialTyping.includes(PEER),
  });
}

describe("conversation-scoped spatial typing", () => {
  it("6. peer in a spatial conversation typing in THAT conversation -> agree-gesture", () => {
    const state = applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: true });
    expect(peerAnim(state)).toBe("agree-gesture");
  });

  it("7. same peer typing only in an unrelated remote DM -> stays listening-gesture", () => {
    const state = applyPeerTypingUpdate({}, { email: PEER, conversationId: REMOTE_DM, isTyping: true });
    expect(peerAnim(state)).toBe("listening-gesture");
    // ...but the any-conversation bubble signal still sees them typing.
    expect(deriveAnyTypingCharacterIds(state, false, "bon")).toEqual([PEER]);
  });

  it("8. a stop (or timeout) in an unrelated conversation does not clear spatial typing", () => {
    let state = applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: true });
    state = applyPeerTypingUpdate(state, { email: PEER, conversationId: REMOTE_DM, isTyping: true });
    state = applyPeerTypingUpdate(state, { email: PEER, conversationId: REMOTE_DM, isTyping: false });
    expect(peerAnim(state)).toBe("agree-gesture");
    // Out-of-order stop for a conversation that was never typing is a no-op (same object).
    const again = applyPeerTypingUpdate(state, { email: PEER, conversationId: "conv-never", isTyping: false });
    expect(again).toBe(state);
  });

  it("9. spatial typing stop/timeout -> listening-gesture", () => {
    let state = applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: true });
    expect(peerAnim(state)).toBe("agree-gesture");
    state = applyPeerTypingUpdate(state, { email: PEER, conversationId: SPATIAL, isTyping: false });
    expect(peerAnim(state)).toBe("listening-gesture");
    expect(state).toEqual({});
  });

  it("10. spatial session changes while the old conversation's typing is still live -> old typing cannot trigger agree", () => {
    const state = applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: true });
    const newSessions = [{ sessionId: "conv-spatial-2", members: [PEER, SELF] }];
    expect(peerAnim(state, newSessions)).toBe("listening-gesture");
    // Once they type in the new session's conversation, agree resumes.
    const state2 = applyPeerTypingUpdate(state, { email: PEER, conversationId: "conv-spatial-2", isTyping: true });
    expect(peerAnim(state2, newSessions)).toBe("agree-gesture");
  });

  it("self typing is scoped to the current spatial conversation id", () => {
    const base = { peerTyping: {}, sessions, selfChatId: SELF, playerLayerId: "bon" };
    expect(deriveSpatialTypingCharacterIds({ ...base, selfTypingConversationId: SPATIAL })).toEqual(["bon"]);
    expect(deriveSpatialTypingCharacterIds({ ...base, selfTypingConversationId: REMOTE_DM })).toEqual([]);
    expect(deriveSpatialTypingCharacterIds({ ...base, selfTypingConversationId: null })).toEqual([]);
  });

  it("ignores typing from members of a 1-member (not yet joined) session", () => {
    const state = applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: true });
    const solo = [{ sessionId: SPATIAL, members: [PEER] }];
    expect(
      deriveSpatialTypingCharacterIds({
        peerTyping: state,
        sessions: solo,
        selfChatId: SELF,
        playerLayerId: "bon",
        selfTypingConversationId: null,
      }),
    ).toEqual([]);
  });

  it("normalizes emails on update and lookup", () => {
    const state = applyPeerTypingUpdate({}, { email: " Alex@Offshorly.com ", conversationId: SPATIAL, isTyping: true });
    expect(Object.keys(state)).toEqual([PEER]);
    expect(peerAnim(state)).toBe("agree-gesture");
  });

  it("applyPeerTypingUpdate returns the same object when nothing changes (React bail-out)", () => {
    const state = applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: true });
    expect(applyPeerTypingUpdate(state, { email: PEER, conversationId: SPATIAL, isTyping: true })).toBe(state);
    expect(applyPeerTypingUpdate({}, { email: PEER, conversationId: SPATIAL, isTyping: false })).toEqual({});
  });
});
