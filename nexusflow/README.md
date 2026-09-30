# NexusFlow

**NexusFlow** is a production-grade, full-stack real-time distributed task pipeline manager. It demonstrates senior-level architecture and engineering: clean layered design, advanced data structures, domain-driven modeling, and a live React dashboard.

---

## Architecture Overview

```
nexusflow/
├── backend/                   # Node.js / TypeScript API
│   └── src/
│       ├── domain/            # Pure entities & value objects
│       │   ├── Task.ts        # Task entity + state machine
│       │   ├── Pipeline.ts    # Pipeline aggregate root
│       │   ├── Worker.ts      # Worker entity & pool stats
│       │   └── ExecutionContext.ts
│       ├── application/       # Use-case classes (CQRS-lite)
│       │   ├── CreatePipeline.ts
│       │   ├── TaskUseCases.ts   # Enqueue, Cancel, Retry
│       │   └── GetDashboardStats.ts
│       ├── infrastructure/    # Adapters & external services
│       │   ├── PriorityQueue.ts  # Min-heap implementation
│       │   ├── DAGResolver.ts    # Kahn's topological sort
│       │   ├── RetryPolicy.ts    # Exponential backoff + jitter
│       │   ├── WorkerPool.ts     # Concurrent worker management
│       │   ├── database/         # SQLite repositories
│       │   └── websocket/        # WS gateway & broadcaster
│       ├── presentation/      # HTTP & WS interfaces
│       │   ├── controllers/   # Express route handlers
│       │   └── middleware/    # Auth, rate-limit, logging
│       └── shared/            # Cross-cutting utilities
│           ├── config.ts      # Validated env config (Zod)
│           ├── errors.ts      # AppError hierarchy
│           ├── logger.ts      # Structured JSON logger
│           └── rateLimiter.ts # Sliding window algorithm
├── frontend/                  # React 18 / TypeScript SPA
│   └── src/
│       ├── components/
│       │   ├── charts/        # Recharts visualizations
│       │   ├── layout/        # App shell & navigation
│       │   ├── pipeline/      # SVG DAG visualizer
│       │   ├── queue/         # Queue inspector panel
│       │   ├── tasks/         # Task table & live feed
│       │   ├── workers/       # Worker pool monitor
│       │   └── ui/            # Shared UI primitives
│       ├── hooks/             # useWebSocket, useQuery, useAuth, useTheme
│       ├── pages/             # Route-level page components
│       ├── services/          # API client (fetch wrapper)
│       └── types/             # Shared TypeScript types
└── README.md
```

### Architectural Layers

| Layer | Responsibility | Depends On |
|---|---|---|
| **Domain** | Pure business entities, state machine, value objects | Nothing |
| **Application** | Orchestrate domain + infrastructure for a use case | Domain, Infrastructure interfaces |
| **Infrastructure** | SQLite repos, WebSocket, priority queue, worker pool | Domain |
| **Presentation** | HTTP controllers, middleware, routing | Application |

---

## Advanced CS Concepts Demonstrated

### 1. Min-Heap Priority Queue (`PriorityQueue.ts`)
A binary min-heap implementing `enqueue` / `dequeue` in **O(log n)** time.
- Heap invariant maintained by `siftUp` (after enqueue) and `siftDown` (after dequeue/remove).
- Secondary sort by `queuedAt` timestamp ensures FIFO ordering within a priority band.
- `remove(taskId)` does a linear scan + reheap: O(n) + O(log n).
- `snapshot()` returns a sorted non-destructive copy for the API/UI.

### 2. DAG Topological Sort — Kahn's Algorithm (`DAGResolver.ts`)
Pipeline tasks form a Directed Acyclic Graph where edges represent dependencies.
- Kahn's algorithm uses in-degree counts and a BFS queue: **O(V + E)** time and space.
- Tasks sharing the same level can execute in **parallel**; levels are sequential.
- Cycle detection is automatic: if `processed < V` after BFS, a cycle exists.
- `getRunnableTasks()` efficiently computes immediately executable tasks at runtime.

### 3. Sliding Window Rate Limiter (`rateLimiter.ts`)
Per-client request rate limiting without a fixed window boundary:
- Maintains a sorted timestamp log per client key.
- On each request, evicts timestamps older than the window, then checks the count.
- When over the limit, calculates `retryAfterMs` from the oldest timestamp in the window.
- `purgeExpired()` runs periodically to prevent unbounded memory growth.

---

## Setup Instructions

### Prerequisites
- Node.js ≥ 20
- npm ≥ 10

### 1. Clone & configure

```bash
git clone <repo>
cd nexusflow
```

Copy the example env and fill in your secrets:
```bash
cp .env.example backend/.env
# Edit backend/.env — set JWT_SECRET and JWT_REFRESH_SECRET to 32+ char random strings
```

### 2. Install & start the backend

```bash
cd backend
npm install
npm run dev
# API:       http://localhost:3001
# WebSocket: ws://localhost:3002
```

### 3. Seed demo data (optional but recommended)

```bash
# In a second terminal, from backend/
npm run seed
```

This creates 5 pipelines with 25+ tasks across all statuses and priorities.

### 4. Install & start the frontend

```bash
cd frontend
npm install
npm run dev
# Dashboard: http://localhost:5173
```

### 5. Login

Navigate to `http://localhost:5173` and use:
- `admin` / `nexusflow-admin` (full access)
- `viewer` / `nexusflow-viewer` (read-only)

---

## API Reference

All protected routes require `Authorization: Bearer <accessToken>`.

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with username/password → accessToken + refreshToken |
| POST | `/api/auth/refresh` | Exchange refreshToken → new token pair (rotation) |
| POST | `/api/auth/logout` | Revoke refresh token |

**Login request:**
```json
{ "username": "admin", "password": "nexusflow-admin" }
```

---

### Pipelines

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pipelines` | List all pipelines (paginated) |
| POST | `/api/pipelines` | Create pipeline with tasks |
| GET | `/api/pipelines/:id` | Get pipeline + all its tasks |
| GET | `/api/pipelines/:id/tasks` | List tasks for a pipeline |
| DELETE | `/api/pipelines/:id` | Delete pipeline and all tasks |

**Create pipeline request:**
```json
{
  "name": "My Pipeline",
  "description": "Optional description",
  "tags": ["etl", "daily"],
  "tasks": [
    {
      "name": "Extract",
      "handler": "db-query",
      "priority": 1,
      "args": { "table": "orders" },
      "dependsOn": [],
      "maxRetries": 3
    },
    {
      "name": "Transform",
      "handler": "data-transform",
      "priority": 2,
      "args": {},
      "dependsOn": ["Extract"]
    }
  ]
}
```

**Priority values:** `0=CRITICAL, 1=HIGH, 2=NORMAL, 3=LOW`

---

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List all tasks (paginated) |
| POST | `/api/tasks` | Enqueue a task to an existing pipeline |
| GET | `/api/tasks/queue` | Snapshot of the in-memory queue |
| GET | `/api/tasks/:id` | Get a single task |
| POST | `/api/tasks/:id/cancel` | Cancel a QUEUED or RUNNING task |
| POST | `/api/tasks/:id/retry` | Re-enqueue a FAILED task |
| DELETE | `/api/tasks/:id` | Delete a task record |

---

### Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/stats` | Full metrics aggregate |
| GET | `/api/dashboard/workers` | Worker pool status + individual workers |

---

## Built-in Task Handlers

These handlers are pre-registered on the worker pool and available for use in pipeline tasks:

| Handler | Description |
|---------|-------------|
| `simulate` | Sleeps for `args.durationMs` ms, optionally fails at `args.failRate` (0–1) |
| `data-transform` | Simulates a data transformation with `args.data` array |
| `api-call` | Simulates an outbound HTTP call to `args.url` |
| `db-query` | Simulates a database query returning random row counts |
| `send-notification` | Simulates sending a notification to `args.channel` |

---

## Running Tests

```bash
cd backend
npm test                 # Run all tests
npm run test:coverage    # Run with coverage report (targets ≥80%)
```

Test files in `backend/tests/`:
- `priorityQueue.test.ts` — heap invariant, FIFO ordering, remove, snapshot
- `stateMachine.test.ts` — all valid/invalid state transitions, terminal states
- `dagResolver.test.ts` — linear chain, parallel, diamond, cycle detection, runnable tasks
- `retryAndRateLimiter.test.ts` — exponential backoff, sliding window rate limiter

---

## Design Decisions

### Why SQLite + better-sqlite3?
Zero infrastructure dependency — no Docker, no external database. Better-sqlite3's synchronous API fits naturally in an Express request/response cycle and simplifies error handling. WAL mode provides excellent read concurrency.

### Why a custom priority queue instead of Bull/Redis?
Demonstrates the underlying data structure (binary min-heap) explicitly. For a production system with multiple API nodes, Bull + Redis would be the right choice. Here, the single-process model keeps setup simple and the implementation educational.

### Why Kahn's algorithm for DAG resolution?
Kahn's BFS approach naturally produces execution *levels* (batches of parallelisable tasks), not just a flat ordering. This is directly useful for the pipeline engine and the visual DAG layout.

### Why synchronous better-sqlite3 API?
better-sqlite3 is synchronous by design and is significantly faster than async SQLite drivers for single-process Node.js. Async I/O provides no benefit when Node.js is single-threaded and SQLite I/O is fast.

### JWT refresh token rotation
Each refresh issues a new refresh token and immediately revokes the old one. This prevents replay attacks from stolen tokens — if an attacker uses a rotated-out token, the server detects the reuse.

### Dependency injection throughout
Every class receives its dependencies via constructor injection. This makes testing trivial (mock the dependencies) and eliminates hidden global state. No IoC container was used — the composition root in `index.ts` wires everything together explicitly.
