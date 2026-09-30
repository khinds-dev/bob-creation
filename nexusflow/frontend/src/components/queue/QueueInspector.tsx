import type { Task, QueueStats } from '../../types';
import { Card, StatCard, EmptyState } from '../ui/Card';
import { statusBadgeClass, priorityBadgeClass, priorityLabel } from '../utils';

interface QueueInspectorProps {
  tasks: Task[];
  stats: QueueStats;
  avgDurationMs?: number;
  concurrency?: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-500',
  NORMAL:   'bg-blue-500',
  LOW:      'bg-gray-400',
};

/** Queue inspector panel showing live queue state and estimated wait times */
export function QueueInspector({ tasks, stats, avgDurationMs = 1000, concurrency = 5 }: QueueInspectorProps) {
  const total = stats.size;

  return (
    <div className="space-y-4">
      {/* Stat overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Queue Depth" value={total} color={total > 20 ? 'red' : total > 10 ? 'yellow' : 'green'} />
        <StatCard label="Critical" value={stats.byPriority['CRITICAL'] ?? 0} color="red" />
        <StatCard label="High" value={stats.byPriority['HIGH'] ?? 0} color="yellow" />
        <StatCard label="Normal + Low" value={(stats.byPriority['NORMAL'] ?? 0) + (stats.byPriority['LOW'] ?? 0)} color="blue" />
      </div>

      {/* Priority breakdown bar */}
      {total > 0 && (
        <Card title="Priority Breakdown">
          <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
            {['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].map((p) => {
              const count = stats.byPriority[p] ?? 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <div
                  key={p}
                  className={`${PRIORITY_COLORS[p] ?? 'bg-gray-400'} h-full transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${p}: ${count}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].map((p) => {
              const count = stats.byPriority[p] ?? 0;
              if (count === 0) return null;
              return (
                <div key={p} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                  <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[p] ?? 'bg-gray-400'}`} />
                  {p}: {count}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Task list */}
      <Card title="Queued Tasks">
        {tasks.length === 0 ? (
          <EmptyState message="Queue is empty" />
        ) : (
          <div className="space-y-2">
            {tasks.map((task, index) => {
              const estimatedWaitMs = Math.ceil((index / concurrency) * avgDurationMs);
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  <span className="text-xs font-mono text-gray-400 w-5 text-right shrink-0">
                    #{index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate block">
                      {task.name}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {task.payload.handler}
                    </span>
                  </div>
                  <span className={priorityBadgeClass(task.priority)}>
                    {priorityLabel(task.priority)}
                  </span>
                  <span className={statusBadgeClass(task.status)}>{task.status}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 w-16 text-right shrink-0">
                    ~{(estimatedWaitMs / 1000).toFixed(1)}s
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
