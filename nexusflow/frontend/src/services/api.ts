import type {
  AuthTokens,
  DashboardStats,
  PaginatedResponse,
  Pipeline,
  Task,
  WorkerInfo,
  WorkerPoolStats,
  CreatePipelineInput,
} from '../types';

const BASE_URL = '/api';

/** Retrieve the stored access token */
function getToken(): string | null {
  return localStorage.getItem('nexusflow_token');
}

/** Store auth tokens */
export function storeTokens(tokens: AuthTokens): void {
  localStorage.setItem('nexusflow_token', tokens.accessToken);
  localStorage.setItem('nexusflow_refresh_token', tokens.refreshToken);
}

/** Clear stored auth tokens */
export function clearTokens(): void {
  localStorage.removeItem('nexusflow_token');
  localStorage.removeItem('nexusflow_refresh_token');
}

/** Base fetch wrapper with auth header and JSON parsing */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json();

  if (!response.ok) {
    const err = data as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${response.status}`);
  }

  return data as T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await apiFetch<void>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  return apiFetch<AuthTokens>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  return apiFetch<DashboardStats>('/dashboard/stats');
}

export async function getWorkers(): Promise<{ workers: WorkerInfo[]; stats: WorkerPoolStats }> {
  return apiFetch('/dashboard/workers');
}

// ─── Pipelines ────────────────────────────────────────────────────────────────

export async function getPipelines(
  limit = 50,
  offset = 0
): Promise<PaginatedResponse<Pipeline>> {
  return apiFetch(`/pipelines?limit=${limit}&offset=${offset}`);
}

export async function getPipeline(id: string): Promise<Pipeline & { tasks: Task[] }> {
  return apiFetch(`/pipelines/${id}`);
}

export async function createPipeline(
  input: CreatePipelineInput
): Promise<{ pipeline: Pipeline; tasks: Task[] }> {
  return apiFetch('/pipelines', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deletePipeline(id: string): Promise<void> {
  return apiFetch(`/pipelines/${id}`, { method: 'DELETE' });
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function getTasks(
  limit = 50,
  offset = 0
): Promise<PaginatedResponse<Task>> {
  return apiFetch(`/tasks?limit=${limit}&offset=${offset}`);
}

export async function getTask(id: string): Promise<Task> {
  return apiFetch(`/tasks/${id}`);
}

export async function getQueue(): Promise<{ tasks: Task[]; stats: { size: number; byPriority: Record<string, number> } }> {
  return apiFetch('/tasks/queue');
}

export async function cancelTask(id: string): Promise<Task> {
  return apiFetch(`/tasks/${id}/cancel`, { method: 'POST' });
}

export async function retryTask(id: string): Promise<Task> {
  return apiFetch(`/tasks/${id}/retry`, { method: 'POST' });
}

export async function deleteTask(id: string): Promise<void> {
  return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
}
