// vo3d core — minimal typed emitter (no framework, no THREE).
export class Emitter<T> {
  private listeners = new Set<(e: T) => void>();
  on(fn: (e: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: T): void {
    for (const fn of this.listeners) fn(e);
  }
}
