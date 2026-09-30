import { useQuery } from '../hooks/useQuery';
import { getQueue, getDashboardStats } from '../services/api';
import { QueueInspector } from '../components/queue/QueueInspector';
import { Spinner } from '../components/ui/Card';

export function QueuePage() {
  const { data: queueData, loading, error, refetch } = useQuery(
    (_s) => getQueue(),
    [],
    { pollInterval: 2000 }
  );

  const { data: stats } = useQuery(
    (_s) => getDashboardStats(),
    [],
    { pollInterval: 5000 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Queue Inspector</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Live view of the in-memory priority queue
        </p>
      </div>

      {loading && !queueData ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 text-sm">
          {error.message} <button onClick={refetch} className="underline ml-1">Retry</button>
        </div>
      ) : (
        <QueueInspector
          tasks={queueData?.tasks ?? []}
          stats={queueData?.stats ?? { size: 0, byPriority: {} }}
          avgDurationMs={stats?.tasks.avgDurationMs ?? 1000}
          concurrency={stats?.workers.total ?? 5}
        />
      )}
    </div>
  );
}
