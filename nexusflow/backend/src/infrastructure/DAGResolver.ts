import { Task } from '../domain/Task';
import { DomainError } from '../shared/errors';

/**
 * DAGResolver — Directed Acyclic Graph topological sort for task pipelines.
 *
 * ## Algorithm: Kahn's Algorithm (BFS-based topological sort)
 *
 * 1. Build an in-degree map counting dependencies for each task.
 * 2. Seed a queue with all zero-in-degree tasks.
 * 3. Repeatedly dequeue, emit, and decrement dependents.
 * 4. If any task remains with in-degree > 0, the graph contains a cycle.
 *
 * ## Complexity
 * Time:  O(V + E) where V = tasks, E = dependency edges
 * Space: O(V + E)
 */
export class DAGResolver {
  /**
   * Compute a topological execution order for the given tasks.
   * Returns an array of task arrays (execution levels/batches):
   * each inner array can execute in parallel; outer arrays must be sequential.
   *
   * @throws {DomainError} when a cyclic dependency is detected
   */
  static resolveExecutionLevels(tasks: Task[]): Task[][] {
    const taskMap = new Map<string, Task>(tasks.map((t) => [t.id, t]));

    // Build in-degree and adjacency list
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // id → ids that depend on id

    for (const task of tasks) {
      if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
      if (!dependents.has(task.id)) dependents.set(task.id, []);

      for (const dep of task.dependsOn) {
        if (!taskMap.has(dep)) {
          throw new DomainError(
            `Task '${task.id}' depends on unknown task '${dep}'`
          );
        }
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
        const list = dependents.get(dep) ?? [];
        list.push(task.id);
        dependents.set(dep, list);
      }
    }

    // Kahn's algorithm
    const levels: Task[][] = [];
    let queue: string[] = [];

    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(id);
    }

    let processed = 0;

    while (queue.length > 0) {
      // All zero-in-degree nodes at this step form one parallel level
      levels.push(queue.map((id) => taskMap.get(id)!));
      processed += queue.length;

      const nextQueue: string[] = [];
      for (const id of queue) {
        for (const dependentId of dependents.get(id) ?? []) {
          const newDegree = (inDegree.get(dependentId) ?? 1) - 1;
          inDegree.set(dependentId, newDegree);
          if (newDegree === 0) nextQueue.push(dependentId);
        }
      }
      queue = nextQueue;
    }

    if (processed !== tasks.length) {
      // Find tasks involved in cycles for a helpful error message
      const cycleNodes = tasks
        .filter((t) => (inDegree.get(t.id) ?? 0) > 0)
        .map((t) => t.name)
        .join(', ');
      throw new DomainError(
        `Cyclic dependency detected in pipeline. Involved tasks: [${cycleNodes}]`
      );
    }

    return levels;
  }

  /**
   * Flatten execution levels to a single ordered list.
   * Tasks within the same level are ordered by priority (ascending numeric value).
   */
  static flattenOrder(tasks: Task[]): Task[] {
    const levels = DAGResolver.resolveExecutionLevels(tasks);
    return levels.flatMap((level) => level.sort((a, b) => a.priority - b.priority));
  }

  /**
   * Determine which tasks are immediately runnable given the current completed set.
   * A task is runnable when all its dependencies are in `completedIds`.
   */
  static getRunnableTasks(tasks: Task[], completedIds: Set<string>): Task[] {
    return tasks.filter(
      (task) =>
        !completedIds.has(task.id) &&
        task.dependsOn.every((dep) => completedIds.has(dep))
    );
  }

  /**
   * Validate that the task graph is acyclic without computing the full order.
   * @throws {DomainError} when a cycle is detected
   */
  static validate(tasks: Task[]): void {
    DAGResolver.resolveExecutionLevels(tasks);
  }
}
