import { useParams, Link } from 'react-router-dom';
import { useQuery } from '../hooks/useQuery';
import { getPipeline, cancelTask, retryTask } from '../services/api';
import { DAGVisualizer } from '../components/pipeline/DAGVisualizer';
import { TaskTable } from '../components/tasks/TaskTable';
import { Spinner, Card } from '../components/ui/Card';
import { formatRelative } from '../components/utils';

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading, error, refetch } = useQuery(
    (_s) => getPipeline(id!),
    [id],
    { pollInterval: 5000 }
  );

  const handleCancel = async (taskId: string) => {
    try { await cancelTask(taskId); refetch(); } catch (err) { alert(String(err)); }
  };
  const handleRetry = async (taskId: string) => {
    try { await retryTask(taskId); refetch(); } catch (err) { alert(String(err)); }
  };

  if (loading && !data) return (
    <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  );

  if (error || !data) return (
    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 text-sm">
      {error?.message ?? 'Pipeline not found'}
      <Link to="/pipelines" className="ml-2 underline">Back</Link>
    </div>
  );

  const completedCount = data.tasks.filter((t) => t.status === 'SUCCESS').length;
  const totalTasks = data.tasks.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link to="/pipelines" className="hover:text-blue-600 dark:hover:text-blue-400">Pipelines</Link>
            <span>/</span>
            <span className="text-gray-700 dark:text-gray-300">{data.name}</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{data.name}</h1>
          {data.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{data.description}</p>
          )}
        </div>
        <div className="text-right text-xs text-gray-500 dark:text-gray-400">
          <p>{completedCount}/{totalTasks} tasks complete</p>
          <p>Created {formatRelative(data.createdAt)}</p>
        </div>
      </div>

      {/* Progress bar */}
      {totalTasks > 0 && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all"
            style={{ width: `${(completedCount / totalTasks) * 100}%` }}
          />
        </div>
      )}

      {/* DAG Visualizer */}
      <Card title="Pipeline DAG">
        <DAGVisualizer tasks={data.tasks} />
      </Card>

      {/* Task table */}
      <TaskTable
        tasks={data.tasks}
        onCancel={(id) => void handleCancel(id)}
        onRetry={(id) => void handleRetry(id)}
      />
    </div>
  );
}
