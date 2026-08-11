MASTER REFERENCE IMAGES — READ BEFORE USING

TWO-STAGE AVATAR-GENERATION ARCHITECTURE (formalized 2026-08-10)

Stage 1 — Upload -> Master (identity anchor, one per person)
  Input:  that employee's own uploaded/reference photo ONLY.
  Output: one Master image = OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE (style spec +
          eye-construction rule) + a pose instruction, single images/edits
          call, single anchor image in, single image out.
  Rule:   identity for a person's Master comes ONLY from that person's own
          upload. Never use another employee's Master (or any other
          employee's asset) as a reference when generating someone's Master.
          Once a Master is approved and locked, the raw upload is retired —
          it is not touched again for that person.

Stage 2 — Master -> Poses (one-hop edits only, many per person)
  Input:  that employee's own locked Master image ONLY (this folder).
  Output: every pose slot (idle/walk/pat x front/back/left/right, etc.),
          each a single images/edits call: SAME Master image + pose-specific
          instruction appended to OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE.
  Rule:   every pose edits the Master directly — never chains pose-to-pose
          (pose output B must not become the input for pose C), never
          re-references the original raw upload once the Master exists, and
          never references another employee's Master or pose output. One
          generation per pose slot — no extra candidate variants.

Files in this folder: Bon_Master.png, Alex_Master.png, Micah_Master.png,
Lui_Master.png — the approved, locked Stage-1 output for each of these 4
existing employees.

Origin: each generated fresh from that person's own original uploaded photo
(Stage 1), using OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE (includes the eye-
construction rule for correct white-sclera eyes). Approved 2026-08-10 from
output/consistency-test-from-upload/{bon,alex,micah,lui}.png.

These files are the source of truth for identity + chibi style per person,
replacing whatever anchor images were used before.

USAGE:
Any pose generation for these 4 people is Stage 2 ONLY: use that person's own
Master file here as the single anchor image, one-hop edit per pose. Do not
chain edits off other poses, older anchors, raw uploads, or any other
person's Master.

DO NOT regenerate or edit these master files without explicit approval. They
represent the approved baseline — treat as locked/frozen.
