// ============================================================
// tests/unit/priority-queue.test.ts
// Unit tests for priority queue implementation
// ============================================================

import { PriorityQueue } from '../../src/core/priority-queue';

describe('PriorityQueue', () => {
  describe('basic operations', () => {
    it('starts empty', () => {
      const pq = new PriorityQueue<string>();
      expect(pq.size).toBe(0);
      expect(pq.isEmpty()).toBe(true);
    });

    it('returns undefined when dequeuing empty queue', () => {
      const pq = new PriorityQueue<string>();
      expect(pq.dequeue()).toBeUndefined();
    });

    it('returns undefined peek on empty queue', () => {
      const pq = new PriorityQueue<string>();
      expect(pq.peek()).toBeUndefined();
    });

    it('enqueues and dequeues a single item', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('hello', 5);
      expect(pq.size).toBe(1);
      expect(pq.peek()).toBe('hello');
      expect(pq.dequeue()).toBe('hello');
      expect(pq.isEmpty()).toBe(true);
    });

    it('tracks size correctly', () => {
      const pq = new PriorityQueue<number>();
      pq.enqueue(1, 5);
      pq.enqueue(2, 3);
      pq.enqueue(3, 7);
      expect(pq.size).toBe(3);
      pq.dequeue();
      expect(pq.size).toBe(2);
    });
  });

  describe('priority ordering', () => {
    it('dequeues highest priority first', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('low', 1);
      pq.enqueue('high', 10);
      pq.enqueue('medium', 5);
      expect(pq.dequeue()).toBe('high');
      expect(pq.dequeue()).toBe('medium');
      expect(pq.dequeue()).toBe('low');
    });

    it('maintains FIFO order for equal priorities', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('first', 5);
      pq.enqueue('second', 5);
      pq.enqueue('third', 5);
      expect(pq.dequeue()).toBe('first');
      expect(pq.dequeue()).toBe('second');
      expect(pq.dequeue()).toBe('third');
    });

    it('handles mixed priorities correctly', () => {
      const pq = new PriorityQueue<number>();
      pq.enqueue(3, 3);
      pq.enqueue(1, 10);
      pq.enqueue(2, 7);
      pq.enqueue(4, 1);
      pq.enqueue(5, 5);

      const dequeued: number[] = [];
      while (!pq.isEmpty()) {
        dequeued.push(pq.dequeue()!);
      }
      expect(dequeued).toEqual([1, 2, 5, 3, 4]);
    });

    it('handles large number of items and dequeues in non-increasing priority order', () => {
      const pq = new PriorityQueue<{ val: number; pri: number }>();
      const N = 1000;
      const priorities: number[] = [];
      for (let i = 0; i < N; i++) {
        const pri = Math.floor(Math.random() * 100);
        priorities.push(pri);
        pq.enqueue({ val: i, pri }, pri);
      }
      expect(pq.size).toBe(N);

      let lastDequeuedPriority = Infinity;
      while (!pq.isEmpty()) {
        const item = pq.dequeue()!;
        expect(item.pri).toBeLessThanOrEqual(lastDequeuedPriority);
        lastDequeuedPriority = item.pri;
      }
      expect(pq.isEmpty()).toBe(true);
    });
  });

  describe('remove', () => {
    it('removes an item by predicate', () => {
      const pq = new PriorityQueue<{ id: string; value: number }>();
      pq.enqueue({ id: 'a', value: 1 }, 5);
      pq.enqueue({ id: 'b', value: 2 }, 10);
      pq.enqueue({ id: 'c', value: 3 }, 1);

      const removed = pq.remove((item) => item.id === 'b');
      expect(removed).toBe(true);
      expect(pq.size).toBe(2);

      const remaining = pq.toArray();
      expect(remaining.find((i) => i.id === 'b')).toBeUndefined();
    });

    it('returns false when item not found', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('a', 5);
      expect(pq.remove((item) => item === 'z')).toBe(false);
    });

    it('maintains heap property after remove', () => {
      const pq = new PriorityQueue<number>();
      pq.enqueue(1, 10);
      pq.enqueue(2, 5);
      pq.enqueue(3, 20);
      pq.enqueue(4, 15);

      pq.remove((item) => item === 3); // remove highest priority

      expect(pq.dequeue()).toBe(4); // next highest
      expect(pq.dequeue()).toBe(1);
      expect(pq.dequeue()).toBe(2);
    });
  });

  describe('removeAll', () => {
    it('removes all matching items', () => {
      const pq = new PriorityQueue<{ group: string; id: number }>();
      pq.enqueue({ group: 'a', id: 1 }, 10);
      pq.enqueue({ group: 'b', id: 2 }, 8);
      pq.enqueue({ group: 'a', id: 3 }, 6);
      pq.enqueue({ group: 'b', id: 4 }, 4);
      pq.enqueue({ group: 'a', id: 5 }, 2);

      const removed = pq.removeAll((item) => item.group === 'a');
      expect(removed).toBe(3);
      expect(pq.size).toBe(2);

      // Only group 'b' items should remain, still in priority order
      expect(pq.dequeue()!.id).toBe(2); // priority 8
      expect(pq.dequeue()!.id).toBe(4); // priority 4
      expect(pq.isEmpty()).toBe(true);
    });

    it('returns 0 when no items match', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('a', 5);
      pq.enqueue('b', 3);
      expect(pq.removeAll((item) => item === 'z')).toBe(0);
      expect(pq.size).toBe(2);
    });

    it('can remove all items', () => {
      const pq = new PriorityQueue<number>();
      pq.enqueue(1, 5);
      pq.enqueue(2, 3);
      pq.enqueue(3, 7);
      expect(pq.removeAll(() => true)).toBe(3);
      expect(pq.isEmpty()).toBe(true);
    });

    it('maintains heap property for remaining items after bulk remove', () => {
      const pq = new PriorityQueue<number>();
      // Add 10 items, mark odd ones for removal
      for (let i = 1; i <= 10; i++) pq.enqueue(i, i);
      pq.removeAll((item) => item % 2 !== 0); // remove 1,3,5,7,9
      expect(pq.size).toBe(5);

      // Remaining should be 10,8,6,4,2 in dequeue order
      const dequeued: number[] = [];
      while (!pq.isEmpty()) dequeued.push(pq.dequeue()!);
      expect(dequeued).toEqual([10, 8, 6, 4, 2]);
    });
  });

  describe('peekPriority', () => {
    it('returns undefined on empty queue', () => {
      expect(new PriorityQueue<string>().peekPriority()).toBeUndefined();
    });

    it('returns the priority of the highest-priority item', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('low', 1);
      pq.enqueue('high', 20);
      pq.enqueue('medium', 10);
      expect(pq.peekPriority()).toBe(20);
    });

    it('updates after dequeue', () => {
      const pq = new PriorityQueue<string>();
      pq.enqueue('a', 10);
      pq.enqueue('b', 5);
      expect(pq.peekPriority()).toBe(10);
      pq.dequeue();
      expect(pq.peekPriority()).toBe(5);
    });
  });

  describe('toArray', () => {
    it('returns items sorted by priority', () => {
      const pq = new PriorityQueue<number>();
      pq.enqueue(3, 3);
      pq.enqueue(1, 10);
      pq.enqueue(2, 7);

      const arr = pq.toArray();
      expect(arr[0]).toBe(1); // priority 10
      expect(arr[1]).toBe(2); // priority 7
      expect(arr[2]).toBe(3); // priority 3
    });

    it('does not mutate the queue', () => {
      const pq = new PriorityQueue<number>();
      pq.enqueue(1, 5);
      pq.enqueue(2, 3);
      pq.toArray();
      expect(pq.size).toBe(2);
    });
  });
});
