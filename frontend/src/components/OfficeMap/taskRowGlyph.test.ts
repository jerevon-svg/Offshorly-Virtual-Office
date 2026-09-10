import { describe, expect, it } from "vitest";
import { taskRowGlyph } from "./taskRowGlyph";
import { HUD_ICONS } from "../HudIcon";

// The backend registry's full event vocabulary (backend/app/services/quests/registry.py's
// EVENT_* constants). Every one a quest or mission can declare must resolve to real art.
const EVENT_TYPES = [
  "check_in",
  "check_out",
  "dm_sent",
  "group_message_sent",
  "ask_to_join",
  "spatial_session_joined",
  "recognition_given",
  "toucan_asked",
  "hub_visited",
  "profile_viewed",
  "coworker_approached",
] as const;

describe("taskRowGlyph", () => {
  it("maps every backend event type to an icon that exists", () => {
    for (const event of EVENT_TYPES) {
      const name = taskRowGlyph(event);
      expect(HUD_ICONS[name], `no art registered for ${event} -> ${name}`).toBeDefined();
    }
  });

  it("returns no emoji — every row is a locked icon asset", () => {
    for (const event of EVENT_TYPES) {
      expect(taskRowGlyph(event)).toMatch(/^[a-z]+$/);
    }
  });

  it("shares one asset across semantically equivalent events", () => {
    expect(taskRowGlyph("check_in")).toBe(taskRowGlyph("check_out"));
    expect(taskRowGlyph("dm_sent")).toBe(taskRowGlyph("group_message_sent"));
    expect(taskRowGlyph("ask_to_join")).toBe(taskRowGlyph("spatial_session_joined"));
  });

  it("keeps distinct semantics distinct", () => {
    const distinct = ["check_in", "dm_sent", "ask_to_join", "recognition_given", "toucan_asked"];
    expect(new Set(distinct.map(taskRowGlyph)).size).toBe(distinct.length);
  });

  it("falls back to a real icon for an unknown or missing event type", () => {
    expect(HUD_ICONS[taskRowGlyph("some_future_event")]).toBeDefined();
    expect(HUD_ICONS[taskRowGlyph("")]).toBeDefined();
  });
});
