import type { PartyWire } from "./goTogether";

// GO TOGETHER PHASE 5 — IS THIS PERSON IN THEIR PARTY'S TRAVELLING CONVERSATION RIGHT NOW?
//
// A MIRROR, NEVER THE AUTHORITY. The server's TravelPartyRegistry.chat_members decides who may speak and who
// hears (backend services/travel_party.py) — this only decides whether this tab shows the Travel Chat and
// routes `/` to it. Same rule, read off the same wire: the journey is under way (Start Walking → arrival),
// this person is one of the participants it took and still following, they are travelling with the group
// (never someone already in the room; someone waiting on the destination floor only once the formation
// picks them up at `to_room`), and this tab is the one driving their body.

const CHAT_STAGES = new Set(["gathering", "ready", "to_lift", "ride", "to_room"]);

export function inTravelChat(party: PartyWire | null, selfEmail: string, isController: boolean): boolean {
  if (!party || !isController || !CHAT_STAGES.has(party.stage)) return false;
  const me = selfEmail.trim().toLowerCase();
  if (!party.rendezvous?.participants.includes(me)) return false;
  const following =
    me === party.leaderEmail ? party.leaderFollowing : party.members.find((m) => m.email === me)?.following;
  if (!following) return false;
  const role = party.roles?.[me] ?? "travel";
  return role === "travel" || (role === "wait" && party.stage === "to_room");
}
