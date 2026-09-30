import clsx from 'clsx';
import type { TaskStatus, TaskPriority } from '../types';

/** Returns Tailwind classes for a given task status */
export function statusBadgeClass(status: TaskStatus): string {
  const map: Record<string, string> = {
    PENDING:   'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    QUEUED:    'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    RUNNING:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    SUCCESS:   'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    FAILED:    'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    CANCELLED: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  };
  return clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', map[status] ?? '');
}

export function priorityBadgeClass(priority: TaskPriority): string {
  const map: Record<number, string> = {
    0: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    1: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    2: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    3: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };
  return clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', map[priority] ?? '');
}

export function priorityLabel(priority: TaskPriority): string {
  return ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'][priority] ?? 'NORMAL';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function formatRelative(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(isoString).toLocaleDateString();
}
