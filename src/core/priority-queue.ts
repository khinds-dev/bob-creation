// ============================================================
// src/core/priority-queue.ts
// Binary-heap-based priority queue (max-heap by priority)
// ============================================================

export interface PQItem<T> {
  item: T;
  priority: number;
  insertionOrder: number;
}

export class PriorityQueue<T> {
  private heap: PQItem<T>[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  enqueue(item: T, priority: number): void {
    const node: PQItem<T> = { item, priority, insertionOrder: this.counter++ };
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.item;
  }

  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  peekPriority(): number | undefined {
    return this.heap[0]?.priority;
  }

  // Remove a specific item by predicate, returns true if found and removed.
  // Only removes the first matching item.
  remove(predicate: (item: T) => boolean): boolean {
    const idx = this.heap.findIndex((node) => predicate(node.item));
    if (idx === -1) return false;

    const last = this.heap.pop()!;
    if (idx < this.heap.length) {
      this.heap[idx] = last;
      this.bubbleUp(idx);
      this.sinkDown(idx);
    }
    return true;
  }

  // Remove ALL items matching predicate, returns number removed.
  removeAll(predicate: (item: T) => boolean): number {
    let removed = 0;
    // Collect indices of all matching items (scan heap array directly)
    // We must rebuild after bulk removal to maintain heap invariant.
    const kept: PQItem<T>[] = [];
    for (const node of this.heap) {
      if (predicate(node.item)) {
        removed++;
      } else {
        kept.push(node);
      }
    }
    if (removed === 0) return 0;
    // Rebuild heap from kept items
    this.heap = kept;
    // Heapify bottom-up
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
      this.sinkDown(i);
    }
    return removed;
  }

  toArray(): T[] {
    // Returns a sorted copy (highest priority first)
    return [...this.heap]
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.insertionOrder - b.insertionOrder;
      })
      .map((n) => n.item);
  }

  private compare(i: number, j: number): boolean {
    const a = this.heap[i];
    const b = this.heap[j];
    if (a.priority !== b.priority) return a.priority > b.priority;
    // FIFO among equal priorities
    return a.insertionOrder < b.insertionOrder;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = Math.floor((idx - 1) / 2);
      if (this.compare(idx, parent)) {
        [this.heap[idx], this.heap[parent]] = [this.heap[parent], this.heap[idx]];
        idx = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      let largest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.compare(left, largest)) largest = left;
      if (right < n && this.compare(right, largest)) largest = right;
      if (largest !== idx) {
        [this.heap[idx], this.heap[largest]] = [this.heap[largest], this.heap[idx]];
        idx = largest;
      } else {
        break;
      }
    }
  }
}
