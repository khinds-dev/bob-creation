import { useMemo, useState } from 'react';
import type { Task } from '../../types';
import { priorityLabel } from '../utils';

interface NodePosition {
  x: number;
  y: number;
  task: Task;
}

interface DAGVisualizerProps {
  tasks: Task[];
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const LEVEL_GAP_X = 220;
const NODE_GAP_Y = 80;
const PADDING = 40;

const STATUS_STROKE: Record<string, string> = {
  PENDING:   '#9ca3af',
  QUEUED:    '#3b82f6',
  RUNNING:   '#f59e0b',
  SUCCESS:   '#22c55e',
  FAILED:    '#ef4444',
  CANCELLED: '#6b7280',
};

/**
 * DAGVisualizer — renders the pipeline task graph as an interactive SVG.
 * Uses Kahn's algorithm levels to compute x positions and stacks nodes
 * within each level at increasing y offsets.
 * No external graph library — pure SVG rendering.
 */
export function DAGVisualizer({ tasks }: DAGVisualizerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { positions, edges, svgWidth, svgHeight } = useMemo(() => {
    if (tasks.length === 0) {
      return { positions: [], edges: [], svgWidth: 300, svgHeight: 120 };
    }

    // Compute levels using Kahn's algorithm
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const task of tasks) {
      if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
      if (!dependents.has(task.id)) dependents.set(task.id, []);
      for (const dep of task.dependsOn) {
        if (taskMap.has(dep)) {
          inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
          const list = dependents.get(dep) ?? [];
          list.push(task.id);
          dependents.set(dep, list);
        }
      }
    }

    const levels: Task[][] = [];
    let queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0);
    let processed = 0;

    while (queue.length > 0) {
      levels.push(queue);
      processed += queue.length;
      const nextQueue: Task[] = [];
      for (const task of queue) {
        for (const depId of dependents.get(task.id) ?? []) {
          const deg = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, deg);
          if (deg === 0) nextQueue.push(taskMap.get(depId)!);
        }
      }
      queue = nextQueue;
    }

    // Any tasks not in levels (cycle) — append at end
    if (processed < tasks.length) {
      const inLevels = new Set(levels.flat().map((t) => t.id));
      levels.push(tasks.filter((t) => !inLevels.has(t.id)));
    }

    // Assign positions
    const posMap = new Map<string, NodePosition>();
    levels.forEach((level, li) => {
      level.forEach((task, ni) => {
        posMap.set(task.id, {
          x: PADDING + li * LEVEL_GAP_X,
          y: PADDING + ni * NODE_GAP_Y,
          task,
        });
      });
    });

    const positions = [...posMap.values()];

    // Build edges
    const edges: Array<{ from: NodePosition; to: NodePosition }> = [];
    for (const task of tasks) {
      const toPos = posMap.get(task.id);
      if (!toPos) continue;
      for (const dep of task.dependsOn) {
        const fromPos = posMap.get(dep);
        if (fromPos) edges.push({ from: fromPos, to: toPos });
      }
    }

    const maxX = Math.max(...positions.map((p) => p.x + NODE_WIDTH)) + PADDING;
    const maxY = Math.max(...positions.map((p) => p.y + NODE_HEIGHT)) + PADDING;

    return { positions, edges, svgWidth: maxX, svgHeight: maxY };
  }, [tasks]);

  return (
    <div className="overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900">
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ minWidth: svgWidth, minHeight: svgHeight }}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map(({ from, to }, i) => {
          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;
          const cx1 = x1 + (x2 - x1) * 0.5;
          const cy1 = y1;
          const cx2 = x1 + (x2 - x1) * 0.5;
          const cy2 = y2;
          const isHighlighted =
            hoveredId === from.task.id || hoveredId === to.task.id;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2 - 8},${y2}`}
              fill="none"
              stroke={isHighlighted ? '#3b82f6' : '#d1d5db'}
              strokeWidth={isHighlighted ? 2 : 1.5}
              markerEnd="url(#arrow)"
              className="transition-all"
            />
          );
        })}

        {/* Nodes */}
        {positions.map(({ x, y, task }) => {
          const stroke = STATUS_STROKE[task.status] ?? '#9ca3af';
          const isHovered = hoveredId === task.id;
          return (
            <g
              key={task.id}
              transform={`translate(${x},${y})`}
              onMouseEnter={() => setHoveredId(task.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                fill={isHovered ? '#eff6ff' : 'white'}
                stroke={isHovered ? '#3b82f6' : stroke}
                strokeWidth={isHovered ? 2 : 1.5}
                className="dark:fill-gray-800 transition-all"
              />
              {/* Status indicator */}
              <circle cx={12} cy={16} r={4} fill={stroke} />
              {/* Task name */}
              <text
                x={22}
                y={20}
                fontSize={11}
                fontWeight="600"
                fill="#1f2937"
                className="dark:fill-gray-100"
              >
                {task.name.length > 16 ? task.name.slice(0, 15) + '…' : task.name}
              </text>
              {/* Priority & status */}
              <text
                x={12}
                y={38}
                fontSize={10}
                fill="#6b7280"
                className="dark:fill-gray-400"
              >
                {priorityLabel(task.priority)} · {task.status}
              </text>
              {/* Duration if available */}
              {task.result?.durationMs && (
                <text x={12} y={50} fontSize={9} fill="#9ca3af">
                  {task.result.durationMs}ms
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
