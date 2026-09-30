import { StatCard, Spinner } from '../components/ui/Card';
import { ExecutionHistoryChart, ThroughputChart, TaskStatusPieChart, AvgDurationChart } from '../components/charts/ExecutionCharts';
import { LiveFeed } from '../components/tasks/TaskTable';
import { useQuery } from '../hooks/useQuery';
import type { DashboardStats, Task } from '../types';
import { getDashboardStats } from '../services/api';
import { formatDuration } from '../components/utils';
import type { RealtimeFeedEntry } from '../hooks/useWebSocket';

interface DashboardPageProps {
  wsConnected: boolean;
  feed: RealtimeFeedEntry[];
}

export function DashboardPage({ wsConnected: _wsConnected, feed }: DashboardPageProps) {
  const { data: stats, loading, error, refetch } = useQuery<DashboardStats>(
    (_signal) => getDashboardStats(),
    [],
    { pollInterval: 5000 }
  );

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
        Failed to load stats: {error.message}
        <button onClick={refetch} className="ml-2 underline">Retry</button>
      </div>
    );
  }

  if (!stats) return null;

  const taskFeedEntries = feed
    .filter((e) => e.event.type.startsWith('task:'))
    .map((e) => ({
      id: e.id,
      type: e.event.type,
      payload: e.event.payload as Task,
      receivedAt: e.receivedAt,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Real-time overview of your task pipeline system
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Tasks"
          value={stats.tasks.total}
          sub={`${stats.tasks.successRate}% success rate`}
          color="blue"
        />
        <StatCard
          label="Running"
          value={stats.tasks.byStatus['RUNNING'] ?? 0}
          sub={`${stats.queue.size} queued`}
          color="yellow"
        />
        <StatCard
          label="Pipelines"
          value={stats.pipelines.total}
          sub={`${stats.pipelines.byStatus['RUNNING'] ?? 0} running`}
          color="blue"
        />
        <StatCard
          label="Avg Duration"
          value={formatDuration(stats.tasks.avgDurationMs)}
          sub={`${stats.workers.throughputPerMinute}/min throughput`}
          color="green"
        />
      </div>

      {/* Worker quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Workers Active" value={`${stats.workers.active}/${stats.workers.total}`} color="yellow" />
        <StatCard label="Completed (total)" value={stats.workers.tasksCompleted} color="green" />
        <StatCard label="Failed (total)" value={stats.workers.tasksFailed} color="red" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExecutionHistoryChart data={stats.history} />
        <TaskStatusPieChart byStatus={stats.tasks.byStatus as Record<string, number>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ThroughputChart data={stats.history} />
        <AvgDurationChart data={stats.history} />
      </div>

      {/* Live feed */}
      <LiveFeed entries={taskFeedEntries} />
    </div>
  );
}
