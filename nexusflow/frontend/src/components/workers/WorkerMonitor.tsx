import type { WorkerInfo, WorkerPoolStats } from '../../types';
import { Card, StatCard, EmptyState } from '../ui/Card';
import clsx from 'clsx';
import { formatDuration } from '../utils';

interface WorkerMonitorProps {
  workers: WorkerInfo[];
  stats: WorkerPoolStats;
}

/** Worker utilization bar */
function UtilizationBar({ pct }: { pct: number }) {
  const color =
    pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
      <div
        className={clsx('h-1.5 rounded-full transition-all', color)}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

/** Full worker pool monitor panel */
export function WorkerMonitor({ workers, stats }: WorkerMonitorProps) {
  const utilPct = stats.totalWorkers > 0
    ? Math.round((stats.activeWorkers / stats.totalWorkers) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Aggregate stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Workers" value={stats.totalWorkers} color="gray" />
        <StatCard label="Active" value={stats.activeWorkers} color="yellow" />
        <StatCard label="Utilization" value={`${utilPct}%`} color={utilPct > 80 ? 'red' : 'green'} />
        <StatCard label="Throughput/min" value={stats.throughputPerMinute} color="blue" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Completed" value={stats.tasksCompleted} color="green" />
        <StatCard label="Failed" value={stats.tasksFailed} color="red" />
        <StatCard
          label="Avg Duration"
          value={formatDuration(stats.avgDurationMs)}
          color="blue"
        />
      </div>

      {/* Pool utilization bar */}
      <Card title="Pool Utilization">
        <div className="flex items-center gap-3">
          <UtilizationBar pct={utilPct} />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10 text-right">
            {utilPct}%
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {stats.activeWorkers} of {stats.totalWorkers} workers processing tasks
        </p>
      </Card>

      {/* Individual workers */}
      <Card title="Worker Details">
        {workers.length === 0 ? (
          <EmptyState message="No workers initialised" />
        ) : (
          <div className="space-y-2">
            {workers.map((w) => (
              <div
                key={w.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700"
              >
                {/* Status dot */}
                <span
                  className={clsx('h-2.5 w-2.5 rounded-full shrink-0', {
                    'bg-green-500': w.status === 'IDLE',
                    'bg-yellow-500 animate-pulse': w.status === 'BUSY',
                    'bg-gray-400': w.status === 'STOPPED',
                  })}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium font-mono text-gray-700 dark:text-gray-300">
                      {w.id}
                    </span>
                    <span className={clsx(
                      'text-xs px-1.5 py-0.5 rounded',
                      w.status === 'BUSY'
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                        : w.status === 'IDLE'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    )}>
                      {w.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {w.tasksCompleted} completed · {w.tasksFailed} failed ·{' '}
                    {formatDuration(w.totalDurationMs)} total
                  </p>
                  {w.currentTaskId && (
                    <p className="mt-0.5 text-xs font-mono text-blue-600 dark:text-blue-400 truncate">
                      → {w.currentTaskId}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
