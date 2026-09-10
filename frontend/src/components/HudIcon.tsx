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
import locateIcon from "../assets/hud-icons/locate.png";
import mapIcon from "../assets/hud-icons/map.png";
import notificationsIcon from "../assets/hud-icons/notifications.png";
import rewardsIcon from "../assets/hud-icons/rewards.png";
import searchIcon from "../assets/hud-icons/search.png";
import settingsIcon from "../assets/hud-icons/settings.png";
import tasksIcon from "../assets/hud-icons/tasks.png";
import xpIcon from "../assets/hud-icons/xp.png";

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
  locate: locateIcon,
  map: mapIcon,
  notifications: notificationsIcon,
  rewards: rewardsIcon,
  search: searchIcon,
  settings: settingsIcon,
  tasks: tasksIcon,
  xp: xpIcon,
} as const;

export type HudIconName = keyof typeof HUD_ICONS;

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
      src={HUD_ICONS[name]}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain", display: "block", flex: "none" }}
    />
  );
}

export default HudIcon;
