# Seat Directions TODO

Full dump of every detected seat (room id + x,y centroid + cellKey) from `seatsForRoomId` across all rooms in `office-layout.ts:rooms`, generated while building the seat-direction mechanism (see `data/seatDirections.ts`). Every seat below currently defaults to `"front"` (no room default, no per-seat override) — fill in real directions in `data/seatDirections.ts`'s `SEAT_DIRECTIONS` table using the `cellKey` column as the key, or set a room-wide `default` for rooms that are mostly one direction.

> Regenerated after the dense-room seat-detection fix (see PR/commit): `dev-team`, `executive-team`, `ai-room`, and `design-team` now derive seats directly from `office-assets-manifest.json` chair/sofa/beanbag coordinates instead of the painted-grid flood-fill, so their coordinates/counts/cellKeys below are ALL NEW — their old `SEAT_DIRECTIONS` entries were removed as stale and need to be redone via `seat-direction-tool.html`. The other 6 rooms (`cms-team`, `qa-room`, `gaming-room`, `project-room`, `meeting-room`, `reception-room`) are unchanged.
>
> Follow-up fix: manifest furniture matching was id-based and silently missed 4 real dev-team visitor chairs whose ids don't contain "chair" (paths do). Matching is now path-based. Only `dev-team`'s section below changed (19 → 23 seats, 4 new rows inserted after row 1 at y≈118.49); `executive-team`, `ai-room`, and `design-team` were re-verified against the corrected matching and are unchanged.
>
> Follow-up fix (wall-nudge removal + sofa splitting): the old wall-avoidance nudge on manifest seats is gone — seat centroids are now the furniture's raw pixel centroid, unnudged (pathfinding already snaps walk-goals to a walkable cell independently at walk time, so this is safe for reachability and fixes a systematic up-left visual misalignment). Additionally, 4 large sofas (`white-sofa-left`, `white-sofa-right` in executive-team; `dev-side-sofa` in dev-team; `design-side-sofa` in design-team) now each produce 3 seats instead of 1, evenly spaced along their long axis. `executive-team` (15 → 19), `dev-team` (23 → 25), and `design-team` (10 → 12) sections below are regenerated; `ai-room` is unchanged (no sofa furniture in that room).
>
> Follow-up fix (qa-room 8-connected flood-fill merge split): `qa-room` is one of the 6 paint-based (non-manifest) rooms and was previously under-detecting seats — its flood-fill clustering is 8-connected, which wrongly merged 3 real chairs' diagonally/orthogonally-adjacent painted `o` cells into one blob. Repainting 2 tiles in `walkable-source.png` (col 8 and col 10 of row 43) split that blob into 3 correctly-placed seats. `qa-room` (6 → 8 seats) below is regenerated; the other 5 paint-based rooms (`cms-team`, `gaming-room`, `project-room`, `meeting-room`, `reception-room`) are unaffected and unchanged.

## AI Room (`ai-room`) — 21 seat(s)

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 176.00 | 70.12 | `176.00,70.12` | front |
| 1 | 163.00 | 118.86 | `163.00,118.86` | front |
| 2 | 189.00 | 118.86 | `189.00,118.86` | front |
| 3 | 72.87 | 172.01 | `72.87,172.01` | front |
| 4 | 117.08 | 172.01 | `117.08,172.01` | front |
| 5 | 152.61 | 172.01 | `152.61,172.01` | front |
| 6 | 196.82 | 172.01 | `196.82,172.01` | front |
| 7 | 232.35 | 172.01 | `232.35,172.01` | front |
| 8 | 276.56 | 172.01 | `276.56,172.01` | front |
| 9 | 72.87 | 203.98 | `72.87,203.98` | front |
| 10 | 117.08 | 203.98 | `117.08,203.98` | front |
| 11 | 152.61 | 203.98 | `152.61,203.98` | front |
| 12 | 196.82 | 203.98 | `196.82,203.98` | front |
| 13 | 232.35 | 203.98 | `232.35,203.98` | front |
| 14 | 276.56 | 203.98 | `276.56,203.98` | front |
| 15 | 72.87 | 235.94 | `72.87,235.94` | front |
| 16 | 117.08 | 235.94 | `117.08,235.94` | front |
| 17 | 152.61 | 235.94 | `152.61,235.94` | front |
| 18 | 196.82 | 235.94 | `196.82,235.94` | front |
| 19 | 232.35 | 235.94 | `232.35,235.94` | front |
| 20 | 276.56 | 235.94 | `276.56,235.94` | front |

## Executive Team (`executive-team`) — 19 seat(s)

`white-sofa-left`/`white-sofa-right` each now produce 3 rows (furnitureId column added below to show which furniture item each seat belongs to).

| # | x | y | cellKey | direction (current) | furnitureId |
| - | - | - | - | - | - |
| 0 | 588.41 | 91.68 | `588.41,91.68` | front | ceo-chair |
| 1 | 864.22 | 91.68 | `864.22,91.68` | front | cto-chair |
| 2 | 726.20 | 158.69 | `726.20,158.69` | front | top-center-sofa |
| 3 | 551.46 | 162.22 | `551.46,162.22` | back | ceo-visitor-chair-1 |
| 4 | 576.09 | 162.22 | `576.09,162.22` | back | ceo-visitor-chair-2 |
| 5 | 600.72 | 162.22 | `600.72,162.22` | back | ceo-visitor-chair-3 |
| 6 | 625.35 | 162.22 | `625.35,162.22` | back | ceo-visitor-chair-4 |
| 7 | 827.26 | 162.22 | `827.26,162.22` | back | cto-visitor-chair-1 |
| 8 | 851.90 | 162.22 | `851.90,162.22` | back | cto-visitor-chair-2 |
| 9 | 876.53 | 162.22 | `876.53,162.22` | back | cto-visitor-chair-3 |
| 10 | 901.16 | 162.22 | `901.16,162.22` | back | cto-visitor-chair-4 |
| 11 | 680.00 | 178.22 | `680.00,178.22` | front | white-sofa-left |
| 12 | 769.78 | 178.22 | `769.78,178.22` | front | white-sofa-right |
| 13 | 680.00 | 205.33 | `680.00,205.33` | front | white-sofa-left |
| 14 | 769.78 | 205.33 | `769.78,205.33` | front | white-sofa-right |
| 15 | 680.00 | 232.44 | `680.00,232.44` | front | white-sofa-left |
| 16 | 769.78 | 232.44 | `769.78,232.44` | front | white-sofa-right |
| 17 | 726.20 | 254.84 | `726.20,254.84` | back | bottom-center-sofa |
| 18 | 880.95 | 258.18 | `880.95,258.18` | front | hr-chair |

Bon: rows 11/13/15 (white-sofa-left) and 12/14/16 (white-sofa-right) are new/unmapped — likely want the same direction across each sofa's 3 rows since they're one physical object, but that's a manual per-seat choice via `seat-direction-tool.html`, not enforced in code.

## Dev Team (`dev-team`) — 25 seat(s)

`dev-side-sofa` now produces 3 rows (22-24). Row 23 (y=273.50) keeps its pre-existing `right` assignment from the old single-seat entry — same coords as before splitting, since it's the middle sub-seat (fraction 1/2 = the sofa's raw centroid).

| # | x | y | cellKey | direction (current) | furnitureId |
| - | - | - | - | - | - |
| 0 | 1207.81 | 75.02 | `1207.81,75.02` | front | dev-lead1-chair |
| 1 | 1335.33 | 75.02 | `1335.33,75.02` | front | dev-lead2-chair |
| 2 | 1196.41 | 118.49 | `1196.41,118.49` | back | dev-lead1-visitor1 |
| 3 | 1219.21 | 118.49 | `1219.21,118.49` | back | dev-lead1-visitor2 |
| 4 | 1323.93 | 118.49 | `1323.93,118.49` | back | dev-lead2-visitor1 |
| 5 | 1346.73 | 118.49 | `1346.73,118.49` | back | dev-lead2-visitor2 |
| 6 | 1176.71 | 156.47 | `1176.71,156.47` | front | dev-bay1-chair1 |
| 7 | 1197.44 | 156.47 | `1197.44,156.47` | front | dev-bay1-chair2 |
| 8 | 1218.18 | 156.47 | `1218.18,156.47` | front | dev-bay1-chair3 |
| 9 | 1238.91 | 156.47 | `1238.91,156.47` | front | dev-bay1-chair4 |
| 10 | 1304.23 | 156.47 | `1304.23,156.47` | front | dev-bay2-chair1 |
| 11 | 1324.96 | 156.47 | `1324.96,156.47` | front | dev-bay2-chair2 |
| 12 | 1345.70 | 156.47 | `1345.70,156.47` | front | dev-bay2-chair3 |
| 13 | 1366.43 | 156.47 | `1366.43,156.47` | front | dev-bay2-chair4 |
| 14 | 1174.68 | 232.78 | `1174.68,232.78` | back | dev-bay1-chair5 |
| 15 | 1196.46 | 232.78 | `1196.46,232.78` | back | dev-bay1-chair6 |
| 16 | 1218.23 | 232.78 | `1218.23,232.78` | back | dev-bay1-chair7 |
| 17 | 1240.00 | 232.78 | `1240.00,232.78` | back | dev-bay1-chair8 |
| 18 | 1302.20 | 232.78 | `1302.20,232.78` | back | dev-bay2-chair5 |
| 19 | 1323.98 | 232.78 | `1323.98,232.78` | back | dev-bay2-chair6 |
| 20 | 1345.75 | 232.78 | `1345.75,232.78` | back | dev-bay2-chair7 |
| 21 | 1367.52 | 232.78 | `1367.52,232.78` | back | dev-bay2-chair8 |
| 22 | 1144.47 | 252.71 | `1144.47,252.71` | front | dev-side-sofa |
| 23 | 1144.47 | 273.50 | `1144.47,273.50` | right | dev-side-sofa |
| 24 | 1144.47 | 294.28 | `1144.47,294.28` | front | dev-side-sofa |

## CMS Team (`cms-team`) — 11 seat(s)

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 1240.00 | 408.00 | `1240.00,408.00` | front |
| 1 | 1336.00 | 408.00 | `1336.00,408.00` | front |
| 2 | 1208.00 | 504.00 | `1208.00,504.00` | back |
| 3 | 1256.00 | 504.00 | `1256.00,504.00` | back |
| 4 | 1320.00 | 504.00 | `1320.00,504.00` | back |
| 5 | 1368.00 | 504.00 | `1368.00,504.00` | back |
| 6 | 1216.00 | 536.00 | `1216.00,536.00` | front |
| 7 | 1176.00 | 544.00 | `1176.00,544.00` | right |
| 8 | 1256.00 | 552.00 | `1256.00,552.00` | back |
| 9 | 1320.00 | 552.00 | `1320.00,552.00` | back |
| 10 | 1368.00 | 552.00 | `1368.00,552.00` | back |

## QA Room (`qa-room`) — 8 seat(s)

> Follow-up fix (8-connected flood-fill merge split): row 1 (`146.67,704.00`) was a single wrongly-merged blob covering 3 real chairs (2 team-lead visitor chairs + the left-cluster-top chair), caused by their painted `o` cells being diagonally/orthogonally adjacent. Repainting 2 tiles in `walkable-source.png` (col 8 and col 10, row 43) broke the merge into 3 separately-detected seats: rows 1, 2, and 3 below (`152.00,696.00`, `184.00,696.00`, `120.00,720.00`) are NEW and have no direction assignment yet (fall back to `front`). Rows 0, 4, 5, 6, 7 are the pre-existing unaffected seats, unchanged.

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 160.00 | 648.00 | `160.00,648.00` | front |
| 1 | 152.00 | 696.00 | `152.00,696.00` | front (unassigned) |
| 2 | 184.00 | 696.00 | `184.00,696.00` | front (unassigned) |
| 3 | 120.00 | 720.00 | `120.00,720.00` | front (unassigned) |
| 4 | 224.00 | 720.00 | `224.00,720.00` | left |
| 5 | 59.56 | 740.44 | `59.56,740.44` | right |
| 6 | 120.00 | 768.00 | `120.00,768.00` | right |
| 7 | 224.00 | 768.00 | `224.00,768.00` | left |

## Design Team (`design-team`) — 12 seat(s)

`design-side-sofa` now produces 3 rows (5, 9, 10). Row 9 (y=509.59) keeps its pre-existing `right` assignment from the old single-seat entry — same coords as before splitting, since it's the middle sub-seat (fraction 1/2 = the sofa's raw centroid).

| # | x | y | cellKey | direction (current) | furnitureId |
| - | - | - | - | - | - |
| 0 | 164.79 | 397.49 | `164.79,397.49` | front | design-lead-chair |
| 1 | 94.22 | 401.72 | `94.22,401.72` | left | design-member-chair1 |
| 2 | 235.36 | 401.72 | `235.36,401.72` | right | design-member-chair7 |
| 3 | 94.22 | 434.21 | `94.22,434.21` | left | design-member-chair2 |
| 4 | 235.36 | 434.21 | `235.36,434.21` | right | design-member-chair6 |
| 5 | 48.17 | 486.10 | `48.17,486.10` | front | design-side-sofa |
| 6 | 114.66 | 487.89 | `114.66,487.89` | back | design-chair-3 |
| 7 | 164.80 | 487.89 | `164.80,487.89` | back | design-member-chair-4 |
| 8 | 214.93 | 487.89 | `214.93,487.89` | back | design-member-chair5 |
| 9 | 48.17 | 509.59 | `48.17,509.59` | right | design-side-sofa |
| 10 | 48.17 | 533.08 | `48.17,533.08` | front | design-side-sofa |
| 11 | 107.27 | 534.15 | `107.27,534.15` | back | design-side-beanbag |

## Gaming Room (`gaming-room`) — 9 seat(s)

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 1400.00 | 688.00 | `1400.00,688.00` | front |
| 1 | 1216.00 | 704.00 | `1216.00,704.00` | right |
| 2 | 1328.00 | 704.00 | `1328.00,704.00` | left |
| 3 | 1272.00 | 744.00 | `1272.00,744.00` | back |
| 4 | 1392.00 | 744.00 | `1392.00,744.00` | back |
| 5 | 1200.00 | 792.00 | `1200.00,792.00` | front |
| 6 | 1248.00 | 792.00 | `1248.00,792.00` | front |
| 7 | 1296.00 | 792.00 | `1296.00,792.00` | front |
| 8 | 1344.00 | 792.00 | `1344.00,792.00` | front |

## Project Room (`project-room`) — 4 seat(s)

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 1136.00 | 1008.00 | `1136.00,1008.00` | right |
| 1 | 1264.00 | 1008.00 | `1264.00,1008.00` | left |
| 2 | 1168.00 | 1088.00 | `1168.00,1088.00` | right |
| 3 | 1232.00 | 1088.00 | `1232.00,1088.00` | left |

## Meeting Room (`meeting-room`) — 6 seat(s)

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 128.00 | 984.00 | `128.00,984.00` | front |
| 1 | 176.00 | 984.00 | `176.00,984.00` | front |
| 2 | 216.00 | 984.00 | `216.00,984.00` | front |
| 3 | 128.00 | 1048.00 | `128.00,1048.00` | back |
| 4 | 176.00 | 1048.00 | `176.00,1048.00` | back |
| 5 | 216.00 | 1048.00 | `216.00,1048.00` | back |

## Reception Room (`reception-room`) — 6 seat(s)

| # | x | y | cellKey | direction (current) |
| - | - | - | - | - |
| 0 | 477.82 | 1017.45 | `477.82,1017.45` | right |
| 1 | 962.18 | 1017.45 | `962.18,1017.45` | left |
| 2 | 416.00 | 1056.00 | `416.00,1056.00` | right |
| 3 | 1024.00 | 1056.00 | `1024.00,1056.00` | left |
| 4 | 480.00 | 1112.00 | `480.00,1112.00` | back |
| 5 | 960.00 | 1112.00 | `960.00,1112.00` | back |

