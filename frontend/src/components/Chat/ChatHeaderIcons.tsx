import HudIcon from "../HudIcon";

// Icons for the floating chat window's header actions. The whiteboard action reuses the SAME
// production asset the dock's Boards tile uses (HUD_ICONS.boards) — one whiteboard image across
// the app; minimize/close are inline strokes in the app's existing inline-SVG idiom rather than
// the "−" / "×" text glyphs they replace. No new assets.

export function WhiteboardActionIcon() {
  return <HudIcon name="boards" size="19px" />;
}

export function MinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 16h12" />
    </svg>
  );
}

export function RestoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="7" width="14" height="11" rx="2" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

export function ComposeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  );
}

/* In-call transport toggles. These are momentary states of a running call rather than the two
   named call ACTIONS (which use the production clay call/video assets), so they stay in the same
   inline-stroke family as minimize/close — no emoji either way. */
export function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 9v3a3 3 0 0 0 4.6 2.5M15 11.5V6a3 3 0 0 0-5.9-.7" />
      <path d="M5 11a7 7 0 0 0 10.5 6M19 11a7 7 0 0 1-.5 2.6" />
      <path d="M12 19v3" />
      <path d="M4 3l16 16" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

export function HangUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 14c4-4.5 14-4.5 18 0l-2.6 2.2-2.9-1.6-.4-2.2a12 12 0 0 0-6.2 0l-.4 2.2-2.9 1.6z" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}
