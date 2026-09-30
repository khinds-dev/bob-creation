// ============================================================
// tests/unit/dag-parser.test.ts
// Unit tests for DAG parsing, cycle detection, dependency resolution
// ============================================================

import { parseDAG, topologicalSort, getReadySteps, DAGParseError } from '../../src/core/dag-parser';
import { DAGDefinition } from '../../src/types';

function makeDAG(overrides: Partial<DAGDefinition> = {}): DAGDefinition {
  return {
    id: 'test-dag',
    name: 'Test DAG',
    steps: [
      { id: 'step-a', name: 'Step A', handler: 'echo' },
      { id: 'step-b', name: 'Step B', handler: 'echo', dependsOn: ['step-a'] },
      { id: 'step-c', name: 'Step C', handler: 'echo', dependsOn: ['step-a'] },
      { id: 'step-d', name: 'Step D', handler: 'echo', dependsOn: ['step-b', 'step-c'] },
    ],
    ...overrides,
  };
}

describe('DAG Parser', () => {
  describe('parseDAG', () => {
    it('parses a valid DAG successfully', () => {
      const dag = makeDAG();
      const result = parseDAG(dag);
      expect(result.definition).toBe(dag);
      expect(result.topologicalOrder).toHaveLength(4);
      expect(result.topologicalOrder[0]).toBe('step-a');
    });

    it('builds correct adjacency list', () => {
      const result = parseDAG(makeDAG());
      expect(result.adjacencyList.get('step-a')).toEqual(expect.arrayContaining(['step-b', 'step-c']));
      expect(result.adjacencyList.get('step-b')).toEqual(['step-d']);
      expect(result.adjacencyList.get('step-d')).toEqual([]);
    });

    it('builds correct dependency map', () => {
      const result = parseDAG(makeDAG());
      expect(result.dependencyMap.get('step-a')).toEqual([]);
      expect(result.dependencyMap.get('step-d')).toEqual(expect.arrayContaining(['step-b', 'step-c']));
    });

    it('computes correct parallel groups', () => {
      const result = parseDAG(makeDAG());
      // Level 0: step-a
      // Level 1: step-b, step-c
      // Level 2: step-d
      expect(result.parallelGroups[0]).toEqual(['step-a']);
      expect(result.parallelGroups[1]).toEqual(expect.arrayContaining(['step-b', 'step-c']));
      expect(result.parallelGroups[2]).toEqual(['step-d']);
    });

    it('throws DAGParseError for empty id', () => {
      expect(() => parseDAG(makeDAG({ id: '' }))).toThrow(DAGParseError);
    });

    it('throws DAGParseError for empty name', () => {
      expect(() => parseDAG(makeDAG({ name: '' }))).toThrow(DAGParseError);
    });

    it('throws DAGParseError for empty steps array', () => {
      expect(() => parseDAG(makeDAG({ steps: [] }))).toThrow(DAGParseError);
    });

    it('throws DAGParseError for duplicate step ids', () => {
      expect(() => parseDAG(makeDAG({
        steps: [
          { id: 'step-a', name: 'A', handler: 'echo' },
          { id: 'step-a', name: 'A dup', handler: 'echo' },
        ],
      }))).toThrow(DAGParseError);
    });

    it('throws DAGParseError when step depends on unknown step', () => {
      expect(() => parseDAG(makeDAG({
        steps: [
          { id: 'step-a', name: 'A', handler: 'echo', dependsOn: ['nonexistent'] },
        ],
      }))).toThrow(DAGParseError);
    });

    it('throws DAGParseError when step depends on itself', () => {
      expect(() => parseDAG(makeDAG({
        steps: [
          { id: 'step-a', name: 'A', handler: 'echo', dependsOn: ['step-a'] },
        ],
      }))).toThrow(DAGParseError);
    });
  });

  describe('Cycle Detection', () => {
    it('detects a simple 2-node cycle', () => {
      expect(() => parseDAG({
        id: 'cyclic-dag',
        name: 'Cyclic',
        steps: [
          { id: 'a', name: 'A', handler: 'echo', dependsOn: ['b'] },
          { id: 'b', name: 'B', handler: 'echo', dependsOn: ['a'] },
        ],
      })).toThrow('cycle');
    });

    it('detects a 3-node cycle', () => {
      expect(() => parseDAG({
        id: 'cyclic-dag',
        name: 'Cyclic',
        steps: [
          { id: 'a', name: 'A', handler: 'echo', dependsOn: ['c'] },
          { id: 'b', name: 'B', handler: 'echo', dependsOn: ['a'] },
          { id: 'c', name: 'C', handler: 'echo', dependsOn: ['b'] },
        ],
      })).toThrow('cycle');
    });

    it('accepts a diamond DAG (no cycle)', () => {
      expect(() => parseDAG(makeDAG())).not.toThrow();
    });
  });

  describe('getReadySteps', () => {
    it('returns only root steps initially', () => {
      const parsed = parseDAG(makeDAG());
      const ready = getReadySteps(parsed, new Set(), new Set(), new Set());
      expect(ready).toEqual(['step-a']);
    });

    it('returns next steps when dependencies complete', () => {
      const parsed = parseDAG(makeDAG());
      const completed = new Set(['step-a']);
      const ready = getReadySteps(parsed, completed, new Set(), new Set());
      expect(ready).toEqual(expect.arrayContaining(['step-b', 'step-c']));
    });

    it('returns final step when all predecessors complete', () => {
      const parsed = parseDAG(makeDAG());
      const completed = new Set(['step-a', 'step-b', 'step-c']);
      const ready = getReadySteps(parsed, completed, new Set(), new Set());
      expect(ready).toEqual(['step-d']);
    });

    it('excludes running steps from ready list', () => {
      const parsed = parseDAG(makeDAG());
      const completed = new Set(['step-a']);
      const running = new Set(['step-b']);
      const ready = getReadySteps(parsed, completed, new Set(), running);
      expect(ready).toEqual(['step-c']); // step-b already running
    });

    it('excludes steps whose dependencies have failed', () => {
      const parsed = parseDAG(makeDAG());
      const completed = new Set(['step-a']);
      const failed = new Set(['step-b']);
      const ready = getReadySteps(parsed, completed, failed, new Set());
      expect(ready).toEqual(['step-c']); // step-c can run; step-d blocked by step-b failure
    });

    it('returns empty when all steps terminal', () => {
      const parsed = parseDAG(makeDAG());
      const completed = new Set(['step-a', 'step-b', 'step-c', 'step-d']);
      const ready = getReadySteps(parsed, completed, new Set(), new Set());
      expect(ready).toEqual([]);
    });
  });

  describe('topologicalSort', () => {
    it('sorts a linear chain', () => {
      const steps = [
        { id: 'c', name: 'C', handler: 'echo', dependsOn: ['b'] },
        { id: 'a', name: 'A', handler: 'echo' },
        { id: 'b', name: 'B', handler: 'echo', dependsOn: ['a'] },
      ];
      const depMap = new Map([
        ['a', []],
        ['b', ['a']],
        ['c', ['b']],
      ]);
      const order = topologicalSort(steps, depMap);
      const idxA = order.indexOf('a');
      const idxB = order.indexOf('b');
      const idxC = order.indexOf('c');
      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });
  });
});
