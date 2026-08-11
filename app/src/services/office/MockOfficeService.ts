import { characterLayers, formatCharacterName, teamRooms } from "../../data/office-layout";
import { mockEmailForAvatarId } from "../../data/avatarIdentity";
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
// The cast is derived from the office manifest's own character layers
// rather than a separate hand-written fixture list, so mock people can
// never drift out of sync with the sprites that actually exist. Emails are
// synthesized from the layer id by mockEmailForAvatarId(), which is the
// exact inverse of the localpart fallback in avatarIdForPerson() — so the
// identity join is exercised in mock mode too, instead of being a code path
// that only ever runs against the real API.

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

// Departments cycle through the six team rooms so mock people spread
// across the floor instead of piling into the fallback room. The names are
// the room ids themselves, which also exercises the slug fallback in
// roomIdForDepartment() — mock mode therefore runs the same placement path
// real data does, rather than a shortcut around it.
const mockDepartments = teamRooms.map((room) => room.id);

const mockPeople = characterLayers.map((layer, index) => ({
  layerId: layer.id,
  email: mockEmailForAvatarId(layer.id),
  displayName: formatCharacterName(layer),
  status: statusFor(index),
  departmentName: mockDepartments[index % mockDepartments.length] ?? null,
}));

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
