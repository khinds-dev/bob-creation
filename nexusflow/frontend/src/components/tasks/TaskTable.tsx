import type { Task } from '../../types';
import { statusBadgeClass, priorityBadgeClass, priorityLabel, formatDuration, formatRelative } from '../utils';
import { Card, EmptyState } from '../ui/Card';
import clsx from 'clsx';

interface TaskTableProps {
  tasks: Task[];
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  title?: string;
}

/** Reusable task table component */
export function TaskTable({ tasks, onCancel, onRetry, title }: TaskTableProps) {
  return (
    <Card title={title ?? `Tasks (${tasks.length})`}>
      {tasks.length === 0 ? (
        <EmptyState message="No tasks found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Name</th>
                <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Priority</th>
                <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Retries</th>
                <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Duration</th>
                <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Updated</th>
                {(onCancel || onRetry) && (
                  <th className="pb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {tasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{task.name}</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500 font-mono truncate max-w-[200px]">
                      {task.payload.handler}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={statusBadgeClass(task.status)}>{task.status}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={priorityBadgeClass(task.priority)}>{priorityLabel(task.priority)}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-400">
                    {task.retryCount}/{task.maxRetries}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-400 font-mono text-xs">
                    {task.result?.durationMs ? formatDuration(task.result.durationMs) : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-500 dark:text-gray-400 text-xs">
                    {formatRelative(task.updatedAt)}
                  </td>
                  {(onCancel || onRetry) && (
                    <td className="py-2.5">
                      <div className="flex gap-1">
                        {onCancel && (task.status === 'QUEUED' || task.status === 'RUNNING') && (
                          <button
                            onClick={() => onCancel(task.id)}
                            className="px-2 py-1 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            Cancel
                          </button>
                        )}
                        {onRetry && task.status === 'FAILED' && (
                          <button
                            onClick={() => onRetry(task.id)}
                            className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface LiveFeedEntry {
  id: string;
  type: string;
  payload: Task;
  receivedAt: string;
}

interface LiveFeedProps {
  entries: LiveFeedEntry[];
}

/** Real-time task event feed */
export function LiveFeed({ entries }: LiveFeedProps) {
  return (
    <Card title="Live Event Feed">
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState message="Waiting for events…" />
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0"
            >
              <span className={clsx('mt-0.5 shrink-0', statusBadgeClass(entry.payload.status))}>
                {entry.type.split(':')[1] ?? entry.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                  {entry.payload.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {new Date(entry.receivedAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
