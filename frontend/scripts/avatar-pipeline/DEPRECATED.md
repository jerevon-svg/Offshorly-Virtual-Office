# DEPRECATED — DO NOT RUN WITHOUT EXPLICIT APPROVAL

This directory contains the old AI avatar-generation pipeline. Its scripts
call paid third-party image-generation APIs (Gemini / GPT-image) to produce
character sprite sheets.

**This is no longer the active avatar workflow.** Avatars for Bon and the
base/placeholder character are now hand-made by Bon and wired directly into
the app as static PNG assets (see `frontend/src/assets/office/characters/chibi-bon/`
and `frontend/src/assets/office/characters/chibi-base/`, consumed by
`frontend/src/data/bonWalkFrames.ts` and
`frontend/src/services/avatar/placeholder.ts`). The in-app "real" generation
path (`RealAvatarService`) is also hard-disabled in code — see
`frontend/src/services/avatar/index.ts`.

Scripts and other files in this directory are kept for reference/rollback
only and have not been deleted or modified. **Do not run any script in this
directory** — including `gen-server.mjs` and anything under `masters/` or
`output/` that re-triggers generation — **without explicit approval from
Bon first, since doing so bills real money against a paid API.**
