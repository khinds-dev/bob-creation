import { useQuery } from '../hooks/useQuery';
import { getWorkers } from '../services/api';
import { WorkerMonitor } from '../components/workers/WorkerMonitor';
import { Spinner } from '../components/ui/Card';

export function WorkersPage() {
  const { data, loading, error, refetch } = useQuery(
    (_s) => getWorkers(),
    [],
    { pollInterval: 2000 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Worker Pool</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Monitor active workers, utilization, and throughput
        </p>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 text-sm">
          {error.message} <button onClick={refetch} className="underline ml-1">Retry</button>
        </div>
      ) : (
        <WorkerMonitor
          workers={data?.workers ?? []}
          stats={data?.stats ?? {
            totalWorkers: 0, activeWorkers: 0, idleWorkers: 0,
            tasksCompleted: 0, tasksFailed: 0, avgDurationMs: 0, throughputPerMinute: 0
          }}
        />
      )}
    </div>
  );
}
