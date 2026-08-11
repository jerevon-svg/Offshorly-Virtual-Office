// TypeScript mirrors of Atlas's office API response models
// (backend/app/schemas/office.py). Field names and nullability are copied
// from the Pydantic models verbatim — do not "tidy" them into camelCase or
// drop the `| null`s, or the shapes stop matching what the wire actually
// sends.
//
// `datetime` fields arrive as ISO-8601 strings over JSON, so they are typed
// `string`, not `Date`. Parse at the point of use.

// backend/app/models/office.py :: PresenceStatus. Sent as the bare enum
// VALUE, so these strings are the wire format verbatim — "ONLINE", not
// "online". Typed as a union rather than `string` because placement logic
// branches on ONLINE specifically (see floorMerge.ts).
export type PresenceStatusValue =
  | "ONLINE"
  | "AWAY"
  | "IN_MEETING"
  | "ON_LEAVE"
  | "OFFLINE";

export interface LastMessage {
  text: string;
  at: string;
}

// GET /api/v1/office/presence  (PresenceOut)
// Also returned by GET /office/rooms/{room_id}/occupants.
export interface Presence {
  user_email: string;
  full_name: string | null;
  photo_url: string | null;
  job_title: string | null;
  department_name: string | null;
  status: PresenceStatusValue;
  source: string;
  current_room_id: string | null;
  // Atlas's OWN canvas coordinates. These are NOT this app's 1440x1244
  // frame coordinates (see data/office-layout.ts FRAME_WIDTH/FRAME_HEIGHT)
  // — the two layouts were authored independently. Do not pipe these
  // straight into a sprite position; place people via room membership
  // instead. Kept on the type because the endpoint sends them.
  avatar_x: number | null;
  avatar_y: number | null;
  checked_in_at: string | null;
  last_seen_at: string | null;
  current_activity: string | null;
  last_message?: LastMessage | null;
}

// GET /api/v1/office/floor  (FloorPersonOut) — full-roster feed.
export interface FloorPerson {
  user_email: string;
  display_name: string;
  status: PresenceStatusValue;
  department_name: string | null;
  team_room_id: string | null;
  current_room_id: string | null;
  source: string;
  current_activity: string | null;
  job_title: string | null;
  last_message?: LastMessage | null;
}

export interface OpenTask {
  task_name: string;
  project_name: string | null;
  // A Zoho TASK status ("Open", "In Progress", ...) — unrelated to
  // PresenceStatusValue. Left as a free string: Atlas passes Zoho's value
  // through without normalizing it to an enum.
  status: string;
  priority: string;
  percent_complete: number;
  due_date: string | null;
}

export interface ActiveChannel {
  room_id: string;
  room_name: string;
  messages_24h: number;
}

// GET /api/v1/office/people/{email}/card  (PersonCardOut)
export interface PersonCard {
  user_email: string;
  display_name: string;
  job_title: string | null;
  department_name: string | null;
  location: string | null;
  zoho_id: string | null;
  status: PresenceStatusValue;
  current_room_id: string | null;
  current_room_name: string | null;
  cliq_dm_url: string;
  can_view_tasks: boolean;
  current_activity?: string | null;
  // Populated ONLY when can_view_tasks is true; null/absent otherwise.
  tasks?: OpenTask[] | null;
  active_channels?: ActiveChannel[] | null;
}

// GET /api/v1/office/map  (MapPersonOut) — geographic view.
export interface MapPerson {
  user_email: string;
  full_name: string | null;
  display_name: string | null;
  photo_url: string | null;
  avatar_url: string;
  department_name: string | null;
  location: string | null;
  home_address: string | null;
  // Null together when the person has never geocoded. Atlas's own client
  // lists these under "No location" rather than pinning them at 0,0.
  latitude: number | null;
  longitude: number | null;
  country_code: string | null;
  status: PresenceStatusValue;
  current_activity: string | null;
  checked_in: boolean;
}

// Atlas rooms are DERIVED — a room is a Zoho department (TEAM), a Zoho
// project (PROJECT), a Cliq channel (CLIQ_CHANNEL), or admin-created
// (CUSTOM). Their ids therefore do NOT line up with this app's ten
// hand-drawn rooms ("ai-room", "dev-team", ...). Modelling the full
// RoomOut is deliberately deferred until we decide how the two room
// namespaces map onto each other — see the rollout plan's open decisions.
// Only the fields needed to make that decision are typed here.
export interface OfficeRoomSummary {
  id: string;
  name: string;
  room_type: "TEAM" | "PROJECT" | "CLIQ_CHANNEL" | "CUSTOM";
  source_ref: string | null;
  display_order: number;
  is_active: boolean;
}

// The subset of Atlas's GET /api/v1/auth/me (MeResponse) this app uses.
// `permissions` is intentionally left loose — useAuthGate reads the one
// flag it needs defensively and nothing else here depends on the rest.
export interface AtlasUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  team: string | null;
}

// One interface, two implementations (Real / Mock), selected in ./index.ts.
// Every method returns plain data — no React, no caching — so callers stay
// free to decide how and when to fetch.
export interface OfficeService {
  getPresence(): Promise<Presence[]>;
  getFloor(): Promise<FloorPerson[]>;
  getMap(): Promise<MapPerson[]>;
  getPersonCard(email: string): Promise<PersonCard>;
  listRooms(): Promise<OfficeRoomSummary[]>;
}
