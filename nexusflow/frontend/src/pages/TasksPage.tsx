import { useQuery } from '../hooks/useQuery';
import { getTasks, cancelTask, retryTask } from '../services/api';
import { TaskTable } from '../components/tasks/TaskTable';
import { Spinner } from '../components/ui/Card';

export function TasksPage() {
  const { data, loading, error, refetch } = useQuery(
    (_s) => getTasks(100, 0),
    [],
    { pollInterval: 5000 }
  );

  const handleCancel = async (id: string) => {
    try { await cancelTask(id); refetch(); } catch (err) { alert(String(err)); }
  };

  const handleRetry = async (id: string) => {
    try { await retryTask(id); refetch(); } catch (err) { alert(String(err)); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Tasks</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          All tasks across all pipelines
        </p>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 text-sm">
          {error.message}
        </div>
      ) : (
        <TaskTable
          tasks={data?.data ?? []}
          onCancel={(id) => void handleCancel(id)}
          onRetry={(id) => void handleRetry(id)}
        />
      )}
    </div>
  );
}
