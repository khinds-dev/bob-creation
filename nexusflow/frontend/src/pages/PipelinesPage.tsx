import { Link } from 'react-router-dom';
import { useQuery } from '../hooks/useQuery';
import { getPipelines, deletePipeline } from '../services/api';
import type { Pipeline } from '../types';
import { Card, EmptyState, Spinner } from '../components/ui/Card';
import { formatRelative } from '../components/utils';
import clsx from 'clsx';

const STATUS_BADGE: Record<string, string> = {
  IDLE:      'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  RUNNING:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  FAILED:    'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

export function PipelinesPage() {
  const { data, loading, error, refetch } = useQuery(
    (_s) => getPipelines(50, 0),
    [],
    { pollInterval: 10_000 }
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pipeline and all its tasks?')) return;
    try {
      await deletePipeline(id);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Pipelines</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Manage and monitor your task pipelines
          </p>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
          {error.message} <button onClick={refetch} className="underline ml-1">Retry</button>
        </div>
      ) : (
        <Card title={`${data?.total ?? 0} Pipelines`}>
          {!data?.data.length ? (
            <EmptyState message="No pipelines yet. Run npm run seed in the backend to create demo data." />
          ) : (
            <div className="space-y-3">
              {data.data.map((p: Pipeline) => (
                <div
                  key={p.id}
                  className="flex items-start justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/pipelines/${p.id}`}
                        className="font-medium text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                        STATUS_BADGE[p.status] ?? ''
                      )}>
                        {p.status}
                      </span>
                      {p.tags.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {p.description && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{p.description}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {p.taskIds.length} tasks · Created {formatRelative(p.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Link
                      to={`/pipelines/${p.id}`}
                      className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => void handleDelete(p.id)}
                      className="px-2.5 py-1 text-xs rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
