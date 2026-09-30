// ============================================================
// src/core/dag-parser.ts
// DAG definition parser and validator
// ============================================================

import { DAGDefinition, StepDefinition } from '../types';

export interface ParsedDAG {
  definition: DAGDefinition;
  adjacencyList: Map<string, string[]>;   // stepId -> dependents (children)
  dependencyMap: Map<string, string[]>;   // stepId -> dependencies (parents)
  topologicalOrder: string[];
  parallelGroups: string[][];
}

export class DAGParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DAGParseError';
  }
}

export function parseDAG(definition: DAGDefinition): ParsedDAG {
  validateDAGStructure(definition);

  const stepIds = new Set(definition.steps.map((s) => s.id));
  const dependencyMap = new Map<string, string[]>();
  const adjacencyList = new Map<string, string[]>();

  // Initialize maps
  for (const step of definition.steps) {
    dependencyMap.set(step.id, []);
    adjacencyList.set(step.id, []);
  }

  // Build dependency and adjacency maps
  for (const step of definition.steps) {
    const deps = step.dependsOn ?? [];
    for (const dep of deps) {
      if (!stepIds.has(dep)) {
        throw new DAGParseError(
          `Step "${step.id}" depends on unknown step "${dep}"`
        );
      }
      dependencyMap.get(step.id)!.push(dep);
      adjacencyList.get(dep)!.push(step.id);
    }
  }

  // Detect cycles using Kahn's algorithm (topological sort)
  const topologicalOrder = topologicalSort(definition.steps, dependencyMap);

  // Compute parallel groups (levels in the DAG)
  const parallelGroups = computeParallelGroups(definition.steps, dependencyMap, topologicalOrder);

  return {
    definition,
    adjacencyList,
    dependencyMap,
    topologicalOrder,
    parallelGroups,
  };
}

function validateDAGStructure(definition: DAGDefinition): void {
  if (!definition.id || definition.id.trim() === '') {
    throw new DAGParseError('DAG definition must have a non-empty id');
  }
  if (!definition.name || definition.name.trim() === '') {
    throw new DAGParseError('DAG definition must have a non-empty name');
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new DAGParseError('DAG definition must have at least one step');
  }

  const stepIds = new Set<string>();
  for (const step of definition.steps) {
    validateStep(step);
    if (stepIds.has(step.id)) {
      throw new DAGParseError(`Duplicate step id: "${step.id}"`);
    }
    stepIds.add(step.id);
  }
}

function validateStep(step: StepDefinition): void {
  if (!step.id || step.id.trim() === '') {
    throw new DAGParseError('Each step must have a non-empty id');
  }
  if (!step.name || step.name.trim() === '') {
    throw new DAGParseError(`Step "${step.id}" must have a non-empty name`);
  }
  if (!step.handler || step.handler.trim() === '') {
    throw new DAGParseError(`Step "${step.id}" must specify a handler`);
  }
  if (step.dependsOn) {
    if (!Array.isArray(step.dependsOn)) {
      throw new DAGParseError(`Step "${step.id}" dependsOn must be an array`);
    }
    if (step.dependsOn.includes(step.id)) {
      throw new DAGParseError(`Step "${step.id}" cannot depend on itself`);
    }
  }
}

export function topologicalSort(
  steps: StepDefinition[],
  dependencyMap: Map<string, string[]>
): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of steps) {
    for (const dep of dependencyMap.get(step.id) ?? []) {
      adjacency.get(dep)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (order.length !== steps.length) {
    throw new DAGParseError(
      'DAG contains a cycle — workflow cannot be executed'
    );
  }

  return order;
}

function computeParallelGroups(
  steps: StepDefinition[],
  dependencyMap: Map<string, string[]>,
  topologicalOrder: string[]
): string[][] {
  const levelMap = new Map<string, number>();

  for (const stepId of topologicalOrder) {
    const deps = dependencyMap.get(stepId) ?? [];
    if (deps.length === 0) {
      levelMap.set(stepId, 0);
    } else {
      const maxDepLevel = Math.max(...deps.map((d) => levelMap.get(d) ?? 0));
      levelMap.set(stepId, maxDepLevel + 1);
    }
  }

  const maxLevel = Math.max(...levelMap.values());
  const groups: string[][] = Array.from({ length: maxLevel + 1 }, () => []);

  for (const step of steps) {
    const level = levelMap.get(step.id) ?? 0;
    groups[level].push(step.id);
  }

  return groups.filter((g) => g.length > 0);
}

export function getReadySteps(
  parsedDAG: ParsedDAG,
  completedStepIds: Set<string>,
  failedStepIds: Set<string>,
  runningStepIds: Set<string>
): string[] {
  const ready: string[] = [];
  for (const stepId of parsedDAG.topologicalOrder) {
    if (completedStepIds.has(stepId) || failedStepIds.has(stepId) || runningStepIds.has(stepId)) {
      continue;
    }
    const deps = parsedDAG.dependencyMap.get(stepId) ?? [];
    const allDepsCompleted = deps.every((dep) => completedStepIds.has(dep));
    const anyDepFailed = deps.some((dep) => failedStepIds.has(dep));
    if (allDepsCompleted && !anyDepFailed) {
      ready.push(stepId);
    }
  }
  return ready;
}
