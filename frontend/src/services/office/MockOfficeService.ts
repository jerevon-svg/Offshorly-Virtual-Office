import { characterLayers, formatCharacterName } from "../../data/office-layout";
import type {
  FloorPerson,
  MapPerson,
  OfficeRoomSummary,
  OfficeService,
  PersonCard,
  Presence,
  PresenceStatusValue,
} from "./types";

// Offline implementation — lets the whole app run with the Atlas backend
// stopped, which is what keeps art/animation work unblocked by API changes.
//
// The cast is the 4 real people this app is bound to (Bon, Micah, Alex,
// Lui), keyed by their real @offshorly.com addresses — the same addresses
// EMAIL_TO_AVATAR_ID / EMAIL_TO_ROOM_ID key off of — rather than a roster
// derived from every character layer in the manifest. The manifest still
// has ~16 other fictional characters for onboarding/checkout flows and
// future hires, but they are not real people and should not appear on the
// mock floor. Room placement for these 4 is forced by roomIdForPerson()'s
// email override regardless of the departmentName below, so the department
// names here are just reasonable labels, not load-bearing.

// Atlas's PresenceStatus values verbatim — the wire format is the bare
// uppercase enum name. Deterministic spread, not Math.random(), so
// screenshots and snapshots stay stable between runs.
function statusFor(index: number): PresenceStatusValue {
  if (index % 7 === 0) return "OFFLINE";
  if (index % 5 === 0) return "ON_LEAVE";
  if (index % 4 === 0) return "IN_MEETING";
  if (index % 3 === 0) return "AWAY";
  return "ONLINE";
}

function displayNameFor(layerId: string): string {
  const layer = characterLayers.find((l) => l.id === layerId);
  return layer ? formatCharacterName(layer) : layerId;
}

const mockPeople = [
  {
    layerId: "bon",
    email: "jerevon@offshorly.com",
    displayName: displayNameFor("bon"),
    status: statusFor(0),
    departmentName: "Design",
  },
  {
    layerId: "micah",
    email: "micah@offshorly.com",
    displayName: displayNameFor("micah"),
    status: statusFor(1),
    departmentName: "Design",
  },
  {
    layerId: "alex",
    email: "alex@offshorly.com",
    displayName: displayNameFor("alex"),
    status: statusFor(2),
    departmentName: "Management",
  },
  {
    layerId: "lui",
    email: "lui@offshorly.com",
    displayName: displayNameFor("lui"),
    status: statusFor(3),
    departmentName: "Dev",
  },
];

export class MockOfficeService implements OfficeService {
  getPresence(): Promise<Presence[]> {
    return Promise.resolve(
      mockPeople.map((person) => ({
        user_email: person.email,
        full_name: person.displayName,
        photo_url: null,
        job_title: null,
        department_name: person.departmentName,
        status: person.status,
        source: "mock",
        current_room_id: null,
        avatar_x: null,
        avatar_y: null,
        checked_in_at: null,
        last_seen_at: null,
        current_activity: null,
        last_message: null,
      })),
    );
  }

  getFloor(): Promise<FloorPerson[]> {
    return Promise.resolve(
      mockPeople.map((person) => ({
        user_email: person.email,
        display_name: person.displayName,
        status: person.status,
        department_name: person.departmentName,
        team_room_id: null,
        current_room_id: null,
        source: "mock",
        current_activity: null,
        job_title: null,
        last_message: null,
      })),
    );
  }

  getMap(): Promise<MapPerson[]> {
    return Promise.resolve(
      mockPeople.map((person) => ({
        user_email: person.email,
        full_name: person.displayName,
        display_name: person.displayName,
        photo_url: null,
        avatar_url: "",
        department_name: person.departmentName,
        location: null,
        home_address: null,
        // Null pair = "never geocoded", the same signal the real endpoint
        // sends. Deliberately not faked coordinates, so any map code that
        // mishandles ungeocoded people fails in mock mode too.
        latitude: null,
        longitude: null,
        country_code: null,
        status: person.status,
        current_activity: null,
        checked_in: person.status === "ONLINE" || person.status === "IN_MEETING",
      })),
    );
  }

  getPersonCard(email: string): Promise<PersonCard> {
    const person = mockPeople.find((candidate) => candidate.email === email);
    if (!person) {
      return Promise.reject(new Error(`No mock person for email "${email}"`));
    }
    return Promise.resolve({
      user_email: person.email,
      display_name: person.displayName,
      job_title: null,
      department_name: person.departmentName,
      location: null,
      zoho_id: null,
      status: person.status,
      current_room_id: null,
      current_room_name: null,
      cliq_dm_url: "",
      // False, so mock mode exercises the same redacted rendering a
      // non-privileged real viewer gets rather than the fully-populated
      // happy path.
      can_view_tasks: false,
      current_activity: null,
      tasks: null,
      active_channels: null,
    });
  }

  listRooms(): Promise<OfficeRoomSummary[]> {
    // Empty on purpose. Atlas's rooms are Zoho departments / projects /
    // Cliq channels, and this app's ten hand-drawn rooms are unrelated to
    // them; inventing plausible-looking mock rooms would imply a mapping
    // that has not been decided yet.
    return Promise.resolve([]);
  }
}

export const mockOfficeService = new MockOfficeService();
