// vo3d app — IS THE TOUCAN BUSY WITH AN AI WORKFORCE JOB (pure; Phase 6B). The shared assistant panel says where the
// bird is; while the job has it somewhere else — at the Lab, or still on its way back — it must not claim to be
// beside the employee.
type P = { x: number; z: number };
/** farther than this from the employee is "not beside you" (the bird parks within ~60 of whoever called it) */
export const TOUCAN_BESIDE_RANGE = 200;
/** the panel's line while the job has the bird */
export const TOUCAN_BUSY_LABEL = "Working with the AI team";

/** busy = the workforce is directing the bird AND either its destination or the bird itself is not beside you */
export function toucanBusyWithJob(directed: P | null, avatar: P, bird: P): boolean {
  if (!directed) return false;
  const far = (a: P) => Math.hypot(a.x - avatar.x, a.z - avatar.z) > TOUCAN_BESIDE_RANGE;
  return far(directed) || far(bird);
}
