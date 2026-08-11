import { apiFetch } from "../api/client";
import type {
  FloorPerson,
  MapPerson,
  OfficeRoomSummary,
  OfficeService,
  PersonCard,
  Presence,
} from "./types";

// Live implementation — talks to Atlas's office API.
//
// Every call goes through apiFetch(), which builds an ABSOLUTE URL from
// VITE_API_URL and attaches the bearer token. Never hand-write a relative
// "/api/..." path here: under Atlas's reverse proxy that resolves against
// atlas.offshorly.com, which has no such routes and answers with Atlas's
// HTML 404 page where JSON is expected (see services/api/client.ts).

// apiFetch has already navigated to /login by the time a 401 Response is
// returned, so a 401 body is meaningless. Every other non-OK status is a
// genuine failure and throws with the status attached, so callers can tell
// "Atlas said no" apart from "the network died".
async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(`Atlas office API ${path} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export class RealOfficeService implements OfficeService {
  getPresence(): Promise<Presence[]> {
    return readJson<Presence[]>("/api/v1/office/presence");
  }

  getFloor(): Promise<FloorPerson[]> {
    return readJson<FloorPerson[]>("/api/v1/office/floor");
  }

  getMap(): Promise<MapPerson[]> {
    return readJson<MapPerson[]>("/api/v1/office/map");
  }

  getPersonCard(email: string): Promise<PersonCard> {
    // Emails can contain characters that are legal in an address but not in
    // a path segment, so encode rather than interpolating raw.
    return readJson<PersonCard>(
      `/api/v1/office/people/${encodeURIComponent(email)}/card`,
    );
  }

  listRooms(): Promise<OfficeRoomSummary[]> {
    // Atlas returns the full RoomOut; OfficeRoomSummary is a narrower view
    // of the same payload (see the note on that type). Extra fields ride
    // along at runtime and are simply not surfaced by the type.
    return readJson<OfficeRoomSummary[]>("/api/v1/office/rooms");
  }
}

export const realOfficeService = new RealOfficeService();
