# HumanBase Studio

A local page that turns an approved Offshorly illustration into a complete, animated HumanBase avatar. It needs no coding.

## Start it

From `frontend/`, start two things:

1. The app dev server, if it isn't already running: `npm run dev` (serves the previews on http://localhost:5173).
2. The studio: `node scripts/avatar-pipeline/human-base/studio/server.mjs`, then open **http://localhost:8094**.

## The six steps (one card each on the page)

| Step | What happens | Cost |
|---|---|---|
| 1 Reference | Pick a person, or upload a new approved illustration (name + hair length). | free |
| 2 Identity analysis | Stage 0 traces the face outline, eyes, nose and mouth. Hair is never treated as skin. The trace turns into the person's Offshorly targets. | free (new uploads download the free face-landmark model once) |
| 3 Meshy head | Reuses the person's existing Meshy head. A **new** head costs about 30 Meshy credits, and the page asks for your approval before anything is sent. | 0 or ≈30 credits |
| 4 Build | Applies the Offshorly style, then the automatic identity correction: face length, eye spacing, face widths below the eyes. The skull stays canonical. Then hair, optimisation, and the fail-closed gate on the real body. About 6–10 minutes. | free |
| 5 Preview | The avatar on the production HumanBase body next to Bon. Choose idle, walk, run or sit. "Make review sheet" makes one image: reference → trace → raw Meshy → before/after correction → full avatar. | free |
| 6 Export | Packages the gated head, gate report, validated head mount, trace and review sheet into `scripts/avatar-pipeline/output/human-base/exports/<name>/`. | free |

## Good to know

- **Production is never touched.** The approved first five are frozen and are never rebuilt here. Promotion into `production/` stays the separate, human-approved `build-employees.mjs --promote` step, after visual sign-off.
- **"Gate FAIL" with no failed classes** means the automated checks passed. The three visual sign-off classes (ear boundary, hair spikes, nape) still need your look before promotion.
- **Jobs survive closing the page.** If the studio server restarts during a step, that step shows "interrupted"; run it again.
- **Resuming a Meshy generation.** If the job was interrupted after submission, the task id is in its log. Resume read-only (no new credits) with `node scripts/avatar-pipeline/human-base/studio/meshy-resume.mjs <name> <taskId>`.
- **Recipes.** Each person's appearance recipe (hair length, accessories, triangle budget) lives in `scripts/avatar-pipeline/human-base/employees.json`. Uploads get a default recipe there.
