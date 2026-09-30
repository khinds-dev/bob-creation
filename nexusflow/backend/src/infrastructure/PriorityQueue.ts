import { Task, TaskPriority } from '../domain/Task';

/**
 * PriorityQueue — a min-heap-based priority queue for Task scheduling.
 *
 * ## Heap Invariant
 * For every node at index i:
 *   heap[i].priority ≤ heap[leftChild(i)].priority
 *   heap[i].priority ≤ heap[rightChild(i)].priority
 *
 * Tie-breaking: when two tasks share equal priority, the earlier `queuedAt`
 * timestamp wins (FIFO within a priority band).
 *
 * ## Complexity
 * | Operation | Time       | Space |
 * |-----------|------------|-------|
 * | enqueue   | O(log n)   | O(1)  |
 * | dequeue   | O(log n)   | O(1)  |
 * | peek      | O(1)       | O(1)  |
 * | remove    | O(n)       | O(1)  |
 * | size      | O(1)       | O(1)  |
 */
export class PriorityQueue {
  private readonly heap: Task[] = [];

  // ─── Index helpers ────────────────────────────────────────────────────────

  private static parent(i: number): number {
    return Math.floor((i - 1) / 2);
  }

  private static left(i: number): number {
    return 2 * i + 1;
  }

  private static right(i: number): number {
    return 2 * i + 2;
  }

  // ─── Comparison ───────────────────────────────────────────────────────────

  /**
   * Returns true when task `a` has higher priority than task `b`.
   * Lower numeric `TaskPriority` value = higher urgency.
   * Secondary sort: earlier queuedAt wins (FIFO per band).
   */
  private hasHigherPriority(a: Task, b: Task): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    const aTime = a.queuedAt?.getTime() ?? a.createdAt.getTime();
    const bTime = b.queuedAt?.getTime() ?? b.createdAt.getTime();
    return aTime < bTime;
  }

  // ─── Heap operations ──────────────────────────────────────────────────────

  private swap(i: number, j: number): void {
    const tmp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = tmp;
  }

  /** Bubble element at index `i` upward to restore heap invariant */
  private siftUp(i: number): void {
    while (i > 0) {
      const p = PriorityQueue.parent(i);
      if (this.hasHigherPriority(this.heap[i], this.heap[p])) {
        this.swap(i, p);
        i = p;
      } else {
        break;
      }
    }
  }

  /** Push element at index `i` downward to restore heap invariant */
  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let highest = i;
      const l = PriorityQueue.left(i);
      const r = PriorityQueue.right(i);

      if (l < n && this.hasHigherPriority(this.heap[l], this.heap[highest])) {
        highest = l;
      }
      if (r < n && this.hasHigherPriority(this.heap[r], this.heap[highest])) {
        highest = r;
      }

      if (highest !== i) {
        this.swap(i, highest);
        i = highest;
      } else {
        break;
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Enqueue a task. O(log n).
   */
  enqueue(task: Task): void {
    this.heap.push(task);
    this.siftUp(this.heap.length - 1);
  }

  /**
   * Remove and return the highest-priority task. O(log n).
   * Returns undefined when the queue is empty.
   */
  dequeue(): Task | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const top = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.siftDown(0);
    return top;
  }

  /**
   * Inspect the next task without removing it. O(1).
   */
  peek(): Task | undefined {
    return this.heap[0];
  }

  /**
   * Remove a specific task by ID. O(n) scan + O(log n) reheap.
   * Returns true if the task was found and removed.
   */
  remove(taskId: string): boolean {
    const i = this.heap.findIndex((t) => t.id === taskId);
    if (i === -1) return false;

    if (i === this.heap.length - 1) {
      this.heap.pop();
      return true;
    }

    this.heap[i] = this.heap.pop()!;
    this.siftUp(i);
    this.siftDown(i);
    return true;
  }

  /** Number of tasks currently in the queue */
  get size(): number {
    return this.heap.length;
  }

  /** True when the queue holds no tasks */
  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Return a snapshot of the queue ordered by priority (non-destructive).
   * Creates a shallow copy and sorts — O(n log n).
   */
  snapshot(): Task[] {
    return [...this.heap].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aTime = a.queuedAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.queuedAt?.getTime() ?? b.createdAt.getTime();
      return aTime - bTime;
    });
  }

  /**
   * Estimate wait time (ms) for a new task at the given priority.
   * Assumes average task duration of `avgDurationMs` and `concurrency` workers.
   */
  estimateWaitMs(priority: TaskPriority, avgDurationMs: number, concurrency: number): number {
    const ahead = this.heap.filter((t) => t.priority <= priority).length;
    const slots = Math.max(1, concurrency);
    return Math.ceil((ahead / slots) * avgDurationMs);
  }
}
