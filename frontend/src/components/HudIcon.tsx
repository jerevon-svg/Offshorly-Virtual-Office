import { currentExperienceTheme } from "../services/settings/experienceTheme";
import boardsIcon from "../assets/hud-icons/boards.png";
import callIcon from "../assets/hud-icons/call.png";
import clockIcon from "../assets/hud-icons/clock.png";
import footstepsIcon from "../assets/hud-icons/footsteps.png";
import kudosIcon from "../assets/hud-icons/kudos.png";
import peopleIcon from "../assets/hud-icons/people.png";
import profileIcon from "../assets/hud-icons/profile.png";
import toucanIcon from "../assets/hud-icons/toucan.png";
import chatIcon from "../assets/hud-icons/chat.png";
import coinIcon from "../assets/hud-icons/coin.png";
import hubIcon from "../assets/hud-icons/hub.png";
import levelIcon from "../assets/hud-icons/level.png";
import lightingIcon from "../assets/hud-icons/lighting.png";
import locateIcon from "../assets/hud-icons/locate.png";
import mapIcon from "../assets/hud-icons/map.png";
import memoryIcon from "../assets/hud-icons/memory.png";
import notificationsIcon from "../assets/hud-icons/notifications.png";
import quillIcon from "../assets/hud-icons/quill.png";
import rewardsIcon from "../assets/hud-icons/rewards.png";
import roomIcon from "../assets/hud-icons/room.png";
import searchIcon from "../assets/hud-icons/search.png";
import settingsIcon from "../assets/hud-icons/settings.png";
import videoIcon from "../assets/hud-icons/video.png";
import tasksIcon from "../assets/hud-icons/tasks.png";
import xpIcon from "../assets/hud-icons/xp.png";

// ---- SEASONAL VARIANTS -------------------------------------------------------------------------
// Halloween re-renders of a few icons, in the SAME soft-3D clay family, at the SAME framing
// (512x512, 438px of content inset 37px — see the family recipe). Same silhouette, same meaning,
// seasonal materials: violet-charcoal bodies with pumpkin-orange accents.
import toucanHalloween from "../assets/hud-icons/halloween/toucan.png";
import notificationsHalloween from "../assets/hud-icons/halloween/notifications.png";
import rewardsHalloween from "../assets/hud-icons/halloween/rewards.png";
import searchHalloween from "../assets/hud-icons/halloween/search.png";
import hubHalloween from "../assets/hud-icons/halloween/hub.png";
import roomHalloween from "../assets/hud-icons/halloween/room.png";
import tasksHalloween from "../assets/hud-icons/halloween/tasks.png";
import chatHalloween from "../assets/hud-icons/halloween/chat.png";
import boardsHalloween from "../assets/hud-icons/halloween/boards.png";
import mapHalloween from "../assets/hud-icons/halloween/map.png";
import settingsHalloween from "../assets/hud-icons/halloween/settings.png";

// The custom 3D clay HUD icon set. These replace the emoji/glyph placeholders that used to sit
// directly in the dock, the player HUD and the chat/notification controls — nothing else about
// those controls changed, so every handler, badge, label and aria-label stays where it was.
export const HUD_ICONS = {
  boards: boardsIcon,
  call: callIcon,
  chat: chatIcon,
  toucan: toucanIcon,
  profile: profileIcon,
  people: peopleIcon,
  kudos: kudosIcon,
  footsteps: footstepsIcon,
  clock: clockIcon,
  coin: coinIcon,
  hub: hubIcon,
  level: levelIcon,
  lighting: lightingIcon,
  locate: locateIcon,
  map: mapIcon,
  memory: memoryIcon,
  notifications: notificationsIcon,
  quill: quillIcon,
  rewards: rewardsIcon,
  // An open cutaway room — floor plate, two walls, a doorway and a pin. Deliberately NOT `people`
  // (two figures, which is "who", not "where") and NOT `hub` (a closed building, which is the company).
  room: roomIcon,
  search: searchIcon,
  settings: settingsIcon,
  video: videoIcon,
  tasks: tasksIcon,
  xp: xpIcon,
} as const;

export type HudIconName = keyof typeof HUD_ICONS;

/** The icons a season replaces. PARTIAL on purpose: an icon with no seasonal variant keeps the
 *  original, which is what lets a season ship a handful of re-renders rather than all twenty-six.
 *
 *  THE ORIGINALS ARE NEVER TOUCHED. This is a lookup in front of HUD_ICONS, not a mutation of it, so
 *  the ordinary 3D office and Classic resolve exactly the same file they always did. */
const HALLOWEEN_HUD_ICONS: Partial<Record<HudIconName, string>> = {
  toucan: toucanHalloween,
  notifications: notificationsHalloween,
  rewards: rewardsHalloween,
  search: searchHalloween,
  hub: hubHalloween,
  room: roomHalloween,
  tasks: tasksHalloween,
  chat: chatHalloween,
  boards: boardsHalloween,
  map: mapHalloween,
  settings: settingsHalloween,
};

const SEASONAL_HUD_ICONS: Record<string, Partial<Record<HudIconName, string>>> = {
  halloween: HALLOWEEN_HUD_ICONS,
};

/** Which file this icon resolves to right now.
 *
 *  Read from the SAME attribute the UI skin is scoped to (services/settings/experienceTheme), so the
 *  icons and the surfaces they sit on can never disagree about which experience is on screen. It is
 *  read at render rather than subscribed to because the experience is resolved once per document and
 *  then held — see App.tsx. */
function iconSrc(name: HudIconName): string {
  const theme = currentExperienceTheme();
  return (theme && SEASONAL_HUD_ICONS[theme]?.[name]) || HUD_ICONS[name];
}

type HudIconProps = {
  name: HudIconName;
  /** Sized in `em` on purpose: the icon then tracks whatever font-size its existing container
      already had, so the dock's responsive sizing and the world-space indicator's distance
      scaling keep working untouched. Pass a value only where a container has no useful size. */
  size?: string;
  className?: string;
};

function HudIcon({ name, size = "1.4em", className }: HudIconProps) {
  return (
    <img
      className={className}
      src={iconSrc(name)}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain", display: "block", flex: "none" }}
    />
  );
}

export default HudIcon;
