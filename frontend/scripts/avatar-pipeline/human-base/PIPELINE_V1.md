# HumanBase Pipeline V1

Universal employee-avatar pipeline: approved illustration → reference prep → Meshy image-to-3D head → `chibify.mjs`
(canonical Alex skull fit, depth band, cranium floor, hairline preservation, living eyes/lids) → `optimize-identity.mjs`.
Accepted 2026-10-04 with five employees.

## Approved production candidates

| Employee | Asset | Head tris | Total tris | Size | Body preset | Accessories |
|---|---|---|---|---|---|---|
| Bon | `public/avatars/human-base-v1/production/bon-v1.glb` | 120k | 160.9k | 1.12 MB | standard | — |
| Micah | `public/avatars/human-base-v1/production/micah-v1.glb` | 80k | 120.8k | 0.79 MB | feminine | `micah-glasses` |
| Angelo | `public/avatars/human-base-v1/production/angelo-v1.glb` | 60k | 100.7k | 0.69 MB | standard | — |
| Clang | `public/avatars/human-base-v1/production/clang-v1.glb` | 60k | 101.6k | 0.81 MB | feminine | `clang-flower` |
| France | `public/avatars/human-base-v1/production/france-v1.glb` | 300k | 340.8k | 1.86 MB | feminine | `france-hair-tail` |

Optimiser: 2048 WebP head texture, Draco. The living-eye atlas (`face_eyes_tex`) is copied back bit-exact — its alpha
carries per-texel codes and data rows and must never be lossy-compressed or resized.

## Regression baselines (local, read-only: `scripts/avatar-pipeline/output/human-base/baseline/`)

- Bon: `bon-meshy-chibi-v2.approved.glb` (ruleset v2; V1 output matches it exactly).
- Micah: `micah-meshy-chibi-v2.approved.glb` — replaced `micah-meshy-chibi-v1.approved.glb` (kept, superseded) after the
  canonical head-depth contract was accepted.
- Checksums of raws, sources, baselines and candidates: `output/human-base/v1-release/MANIFEST.sha256`; final QA sheets in
  `output/human-base/v1-release/qa/`.

## Rulesets

Bon and Micah build with `--ruleset=v2`, new employees with v3 (default). The earlier "v3 preview" heads of Bon and Micah
are retired (moved to `output/human-base/retired/`, removed from the catalogue) and are not production assets.

## Future work (not done in V1)

- **Eye layer overhead:** every head carries ~37k unsimplified `face_eyes` triangles (96×96 grid × 2 eyes). Largest
  remaining triangle saving; deliberately left alone at V1 to keep the eye/lid system stable.
- France's head stays at 300k: below 200k her face shading blotches.
- Angelo's open eye inherits coarse Meshy eye paint (source, not pipeline).
