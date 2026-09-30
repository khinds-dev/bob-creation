import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { HistoryPoint } from '../../types';
import { Card } from '../ui/Card';

interface ExecutionChartProps {
  data: HistoryPoint[];
}

/** Line chart showing task success/failure counts over time */
export function ExecutionHistoryChart({ data }: ExecutionChartProps) {
  const chartData = data.map((d) => ({
    time: d.minute.slice(11, 16),
    Success: d.success,
    Failed: d.failed,
    'Avg Duration (ms)': d.avgDurationMs,
  }));

  return (
    <Card title="Execution History (last 60 min)">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="Success" stroke="#22c55e" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

interface ThroughputChartProps {
  data: HistoryPoint[];
}

/** Bar chart showing throughput (tasks completed) per minute */
export function ThroughputChart({ data }: ThroughputChartProps) {
  const chartData = data.map((d) => ({
    time: d.minute.slice(11, 16),
    Tasks: d.success + d.failed,
  }));

  return (
    <Card title="Throughput per Minute">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="Tasks" fill="#3b82f6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: '#22c55e',
  FAILED: '#ef4444',
  RUNNING: '#f59e0b',
  QUEUED: '#3b82f6',
  PENDING: '#9ca3af',
  CANCELLED: '#6b7280',
};

interface TaskStatusPieProps {
  byStatus: Record<string, number>;
}

/** Pie chart of task distribution by status */
export function TaskStatusPieChart({ byStatus }: TaskStatusPieProps) {
  const data = Object.entries(byStatus)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  if (data.length === 0) return null;

  return (
    <Card title="Tasks by Status">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#9ca3af'} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

interface AvgDurationChartProps {
  data: HistoryPoint[];
}

/** Line chart for average task duration over time */
export function AvgDurationChart({ data }: AvgDurationChartProps) {
  const chartData = data
    .filter((d) => d.avgDurationMs > 0)
    .map((d) => ({
      time: d.minute.slice(11, 16),
      'Avg Duration (ms)': d.avgDurationMs,
    }));

  return (
    <Card title="Avg Task Duration (ms)">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="Avg Duration (ms)"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
