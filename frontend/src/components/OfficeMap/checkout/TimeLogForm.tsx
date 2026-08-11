import { APPROVED_CATEGORIES } from "../../../services/zoho/types";
import type { TimeLogEntry, ZohoProject, ZohoTask } from "../../../services/zoho/types";
import type { validateAllocation } from "../../../data/workedTime";
import { formatDuration } from "../../../data/workedTime";
import styles from "./checkout.module.css";

type Allocation = ReturnType<typeof validateAllocation>;

type Props = {
  entries: TimeLogEntry[];
  projects: ZohoProject[];
  tasks: ZohoTask[];
  allocation: Allocation;
  workedLabel: string;
  error: string | null;
  onUpdateEntry: (index: number, patch: Partial<TimeLogEntry>) => void;
  onAddEntry: () => void;
  onRemoveEntry: (index: number) => void;
  onContinue: () => void;
};

// Each entry logs against EITHER a project+task OR an approved category —
// mutually exclusive. Selecting one clears the other on that same entry.
export function TimeLogForm({
  entries,
  projects,
  tasks,
  allocation,
  workedLabel,
  error,
  onUpdateEntry,
  onAddEntry,
  onRemoveEntry,
  onContinue,
}: Props) {
  const projectsLoading = projects.length === 0;

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Log today's work</div>
      {error && <div className={styles.error}>{error}</div>}
      {entries.map((entry, index) => {
        const usingCategory = entry.category !== null;
        const usingProject = entry.projectId !== null;
        const entryTasks = tasks.filter((t) => t.projectId === entry.projectId);
        return (
          <div key={index} className={styles.entryCard}>
            <div className={styles.entryHeader}>
              <span>Entry {index + 1}</span>
              {entries.length > 1 && (
                <button className={styles.removeBtn} onClick={() => onRemoveEntry(index)}>
                  Remove
                </button>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Project</label>
              <select
                className={styles.select}
                value={entry.projectId ?? ""}
                disabled={usingCategory}
                onChange={(e) =>
                  onUpdateEntry(index, {
                    projectId: e.target.value || null,
                    taskId: null,
                    category: null,
                  })
                }
              >
                <option value="">
                  {projectsLoading ? "Loading projects…" : "Select a project"}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {usingProject && (
              <div className={styles.field}>
                <label className={styles.label}>Task</label>
                <select
                  className={styles.select}
                  value={entry.taskId ?? ""}
                  onChange={(e) => onUpdateEntry(index, { taskId: e.target.value || null })}
                >
                  <option value="">
                    {entryTasks.length === 0 ? "Loading tasks…" : "Select a task"}
                  </option>
                  {entryTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label}>Or an approved category</label>
              <select
                className={styles.select}
                value={entry.category ?? ""}
                disabled={usingProject}
                onChange={(e) =>
                  onUpdateEntry(index, {
                    category: e.target.value || null,
                    projectId: null,
                    taskId: null,
                  })
                }
              >
                <option value="">Select a category</option>
                {APPROVED_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Time spent (minutes)</label>
              <input
                className={styles.input}
                type="number"
                min={0}
                value={entry.timeSpentMinutes}
                onChange={(e) =>
                  onUpdateEntry(index, { timeSpentMinutes: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Work description</label>
              <textarea
                className={styles.textarea}
                value={entry.workDescription}
                onChange={(e) => onUpdateEntry(index, { workDescription: e.target.value })}
              />
            </div>

            {/* Billable defaults to ON: it is the common case, and Zoho's
                own default. `?? true` rather than a plain read, because
                entries created before this field existed have it
                undefined and must not silently become non-billable. */}
            <div className={styles.field}>
              <label className={styles.label} style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={entry.billable ?? true}
                  onChange={(e) => onUpdateEntry(index, { billable: e.target.checked })}
                />
                Billable
              </label>
            </div>
          </div>
        );
      })}

      <button className={styles.addBtn} onClick={onAddEntry}>
        + Add another project or task
      </button>

      <div className={`${styles.allocationLine} ${allocation.isFullyAllocated ? "" : styles.warn}`}>
        Worked today: {workedLabel} · Logged to projects: {formatDuration(allocation.totalLoggedMinutes)} ·
        Remaining: {formatDuration(allocation.remainingMinutes)}
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} onClick={onContinue}>
          Review log
        </button>
      </div>
    </div>
  );
}

export default TimeLogForm;
