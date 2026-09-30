import { TaskRepository } from '../infrastructure/database/TaskRepository';
import { PipelineRepository } from '../infrastructure/database/PipelineRepository';
import { WorkerPool } from '../infrastructure/WorkerPool';
import { TaskStatus } from '../domain/Task';
import { PipelineStatus } from '../domain/Pipeline';

export interface DashboardStats {
  tasks: {
    total: number;
    byStatus: Record<TaskStatus, number>;
    avgDurationMs: number;
    recentThroughput: number;
    successRate: number;
  };
  pipelines: {
    total: number;
    byStatus: Record<PipelineStatus, number>;
  };
  queue: {
    size: number;
    byPriority: Record<string, number>;
  };
  workers: {
    total: number;
    active: number;
    idle: number;
    tasksCompleted: number;
    tasksFailed: number;
    avgDurationMs: number;
    throughputPerMinute: number;
  };
  history: Array<{
    minute: string;
    success: number;
    failed: number;
    avgDurationMs: number;
  }>;
}

/**
 * GetDashboardStats use case — aggregates all metrics for the live dashboard.
 * Designed to be called frequently (polled or on-demand).
 */
export class GetDashboardStats {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly pipelineRepo: PipelineRepository,
    private readonly workerPool: WorkerPool
  ) {}

  execute(): DashboardStats {
    const taskCounts = this.taskRepo.countByStatus();
    const pipelineCounts = this.pipelineRepo.countByStatus();
    const workerStats = this.workerPool.getStats();
    const queueStats = this.workerPool.getQueueStats();
    const avgDurationMs = this.taskRepo.avgCompletedDurationMs();
    const recentThroughput = this.taskRepo.recentThroughput();
    const history = this.taskRepo.executionHistory(60);

    const completed = taskCounts[TaskStatus.SUCCESS] ?? 0;
    const failed = taskCounts[TaskStatus.FAILED] ?? 0;
    const total = completed + failed;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      tasks: {
        total: (Object.values(taskCounts) as number[]).reduce((a: number, b: number) => a + b, 0),
        byStatus: taskCounts,
        avgDurationMs,
        recentThroughput,
        successRate,
      },
      pipelines: {
        total: this.pipelineRepo.count(),
        byStatus: pipelineCounts,
      },
      queue: queueStats,
      workers: {
        total: workerStats.totalWorkers,
        active: workerStats.activeWorkers,
        idle: workerStats.idleWorkers,
        tasksCompleted: workerStats.tasksCompleted,
        tasksFailed: workerStats.tasksFailed,
        avgDurationMs: workerStats.avgDurationMs,
        throughputPerMinute: workerStats.throughputPerMinute,
      },
      history,
    };
  }
}
