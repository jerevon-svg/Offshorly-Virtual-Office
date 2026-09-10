import type { HudIconName } from "../HudIcon";

// Row art for Quests and Missions — the locked VO clay icon set, no emoji.
//
// Keyed off `eventType`, NOT the title. Every quest and mission in the backend registry declares
// the event that completes it (see backend/app/services/quests/registry.py and missions.py), so
// this maps the finite, stable set of events rather than pattern-matching prose that a copy edit
// could silently break. A retitled quest keeps its icon; a genuinely new event type falls back
// visibly rather than mismatching.
//
// One asset is deliberately shared wherever two events mean the same thing to a reader:
//   check_in / check_out          → the clock (both are attendance & time)
//   dm_sent / group_message_sent  → chat (both are "you sent a message")
//   spatial_session_joined / ask_to_join → people (both are "join others")
// Three more reuse existing HUD icons outright, so only six new assets were generated.
const BY_EVENT: Readonly<Record<string, HudIconName>> = {
  check_in: "clock",
  check_out: "clock",
  dm_sent: "chat",
  group_message_sent: "chat",
  ask_to_join: "people",
  spatial_session_joined: "people",
  recognition_given: "kudos",
  toucan_asked: "toucan",
  hub_visited: "hub",
  profile_viewed: "profile",
  coworker_approached: "footsteps",
};

/** The icon standing for what this quest/mission is about. */
export function taskRowGlyph(eventType: string): HudIconName {
  return BY_EVENT[eventType] ?? "tasks";
}
