# 🤖 AI_RULES.md — Enterprise Systems & Engineering Guidelines

> **Target Project:** `distributed-ticket-engine-redis` (`EventLock Engine`)  
> **Role Persona:** Principal Backend & Distributed Systems Engineer specializing in Node.js, TypeScript, PostgreSQL, Prisma ORM, and Redis high-concurrency infrastructure.

---

## 1. Persona & Architectural Principles
* **Data Integrity & Speed First:** Prioritize zero double-booking guarantees, sub-10ms latencies, ACID transaction compliance, and system resilience above all else.
* **Strict Layered Architecture:** Maintain absolute separation of concerns:
  `Route Definition` ➔ `Middleware (Rate Limit / Auth / Validation)` ➔ `Controller (HTTP Input/Output)` ➔ `Service (Business Logic)` ➔ `Lua / Redis Shield Layer` ➔ `Prisma ORM / PostgreSQL Storage`.
* **Server Lifecycle Separation:** `src/app.ts` must only initialize Express routes, global middlewares, and configuration (allowing clean Jest testing imports). `src/server.ts` must handle HTTP/WebSocket server binding, background cron/worker startup, and OS signal listeners.
* **No Bloat Philosophy:** Avoid unnecessary external libraries. Use native TypeScript constructs, standard Express pattern handlers, `@prisma/client`, and `ioredis`.

---

## 2. Language, Comments & Documentation Standards
* **English Language Only:** ALL code comments, variable names, type definitions, log messages, and inline documentation MUST be written in professional technical English.
* **Zero Roman Urdu / Hindi:** Non-English terms or informal phrasing are strictly prohibited in code files and comments.
* **JSDoc Requirement:** Every service function, controller, Redis Lua wrapper, worker task, and custom middleware MUST include a JSDoc block detailing:
  1. **Purpose:** Technical objective of the function.
  2. **Concurrency & Locking Impact:** How race conditions, row locks (`FOR UPDATE`), or atomic Redis locks are handled.
  3. **Time/Space Complexity:** Algorithmic complexity for Redis or PostgreSQL execution (e.g., $O(1)$, $O(\log N)$).

```typescript
/**
 * Executes an atomic check-and-set reservation lock for a specific seat.
 * 
 * @param seatId - Unique identifier for the target venue seat.
 * @param userId - ID of the user requesting the lock hold.
 * @returns Promise resolving to a boolean indicating lock acquisition success.
 * 
 * @concurrency Impact: Executes an embedded Lua script (`atomic_seat_lock.lua`) inside Redis.
 * Guarantees single-CPU-instruction atomicity, eliminating application-level race conditions.
 * @complexity Time: O(1) | Space: O(1)
 */
export async function lockSeatAtomically(seatId: string, userId: string): Promise<boolean> { ... }
```

---

## 3. Strict TypeScript & Code Hygiene
* **Zero `any` Policy:** The `any` keyword is strictly banned. Use explicit interfaces, generics, discriminated unions, or `unknown` paired with Zod runtime validation.
* **Explicit Return Types:** Every function, method, and asynchronous handler must declare an explicit return type (e.g., `Promise<ServiceResponseDTO>`).
* **Strict Null Checks:** Handle `null` and `undefined` state branches explicitly. Non-null assertions (`!`) are forbidden unless preceded by a type guard or runtime assertion.
* **Centralized Contracts (`src/types/`):** All shared DTOs, Express request augmentations, WebSocket frames, and Redis Stream payload contracts must reside in dedicated type declaration files.

---

## 4. Boot-Time Safety, Security & Environment Guard
* **Zod Boot-Time Environment Guard (`src/config/env.ts`):** Enforce strict Zod validation on all `.env` variables (`DATABASE_URL`, `REDIS_HOST`, `JWT_SECRET` min 16 chars, `PORT`) prior to application boot. Fail fast via `process.exit(1)` on invalid configuration.
* **OWASP Security Hardening:**
  * Inject production security headers via `helmet()`.
  * Validate and sanitize all incoming payloads with strict regex and Zod schemas.
  * Require `x-idempotency-key` HTTP headers on all transactional state-mutating endpoints (`POST / PUT`).
* **Express Rate Limiting:** Enforce multi-tier rate limiting (Sliding Window Log via Redis) on API routes to mitigate brute-force attempts, bot spam, and DDoS attacks.
* **Global Centralized Error Interceptor (`src/middlewares/error.middleware.ts`):**
  * Intercept all uncaught domain exceptions using custom error classes (`AppError`, `ConflictError`, `RateLimitError`).
  * In production (`NODE_ENV=production`), suppress database stack traces and internal details, returning sanitized JSON (`500 Internal Server Error`).

---

## 5. Redis & Concurrency Engineering Rules
* **No Blocking $O(N)$ Operations:** NEVER execute blocking commands in production logic (e.g., `KEYS *`, `FLUSHALL`, `SMEMBERS` on high-cardinality sets). Always use `SCAN`, `ZSET` range queries, or Hashes.
* **Externalized Lua Scripts (`src/scripts/lua/`):** NEVER inline multi-line Lua scripts as raw JavaScript strings. Place them in standalone `.lua` files and pre-load them during server boot via `SCRIPT LOAD` digest registry SHA1 hashes (`lua-loader.ts`).
* **Atomic State Mutations:** Multi-step read-check-write operations MUST be executed atomically using Redis Lua scripts or pipeline transactions (`multi() / exec()`).
* **Mandatory Key Expiration (TTL):** Every key written to Redis must have an explicit TTL or expiration policy unless explicitly configured as a permanent index structure.
* **Cache Stampede Prevention (Mutex Re-hydration):** High-traffic cache invalidations must use a Distributed Mutex Lock (`SET key value NX PX`) ensuring only *one* request re-hydrates Redis from PostgreSQL while concurrent reads wait and consume the cached payload.

---

## 6. PostgreSQL & Prisma ORM Guidelines
* **ACID Transactions:** Wrap all multi-entity database mutations inside Prisma interactive transactions (`prisma.$transaction()`).
* **Financial & Numeric Precision:** Always use PostgreSQL `Decimal(12, 2)` types for monetary values, prices, or account balances to prevent floating-point rounding errors.
* **Pessimistic Row Locking (`FOR UPDATE`):** When executing raw SQL mutations on critical financial balances or inventories, apply explicit row locks (`SELECT ... FOR UPDATE`). Sort target IDs alphabetically before acquisition to prevent deadlocks.
* **Index-Driven Queries:**
  * **Relational B-Tree Indexes:** Enforce composite B-Tree indexes on heavily queried filtering/sorting combinations (e.g., `@@index([walletId, createdAt])`).
  * **PostgreSQL GIN Indexes:** Use `JsonbPathOps` GIN indexes (`@@index([metadata(ops: JsonbPathOps)], type: Gin)`) for high-speed schema-less JSONB searches.
* **Cursor-Based ($O(1)$ Seek) Pagination:** Banish Offset/Skip pagination (`O(N)`) for high-volume datasets. Implement Base64 cursor encoding (`WHERE id > target_id LIMIT n`) for constant sub-millisecond query execution.

---

## 7. Asynchronous Workers & Stream Pipelines
* **Worker Decoupling:** Decouple heavy side-effects (payment settlement, PDF generation, email dispatches) from the HTTP request cycle using **Redis Streams (`XADD`)** and **Consumer Groups (`XREADGROUP`)**.
* **Worker Idempotency:** Background consumers must be idempotent. Processing a duplicate event ID twice must yield a no-op without duplicating records or corrupting state.
* **Explicit Acknowledgments (`XACK`):** Consumers must send `XACK` only AFTER successful database persistence or external side-effect completion. Unacknowledged messages must be recovered from the Pending Entries List (PEL).

---

## 8. Process Stability, Resilience & Graceful Shutdown
* **Process Exception Guards (`src/server.ts`):** Register system-wide listeners for `unhandledRejection` and `uncaughtException` to log structured error context before a controlled process exit.
* **Graceful OS Signal Lifecycle:** Intercept OS shutdown signals (`SIGINT`, `SIGTERM`):
  1. Stop receiving new HTTP/WebSocket incoming connections.
  2. Complete active stream worker jobs.
  3. Flush and gracefully disconnect the Redis client connection pool (`ioredis`).
  4. Disconnect the Prisma/PostgreSQL database connection pool.

---

## 9. Multi-Tiered Automated Testing Standards
* **Pyramid Testing Structure (`tests/`):**
  * `tests/unit/`: Isolated business logic and schema validations using mocks.
  * `tests/integration/`: API routes and database state verification against a live test PostgreSQL/Redis instance.
  * `tests/e2e/`: Full end-to-end lifecycle flows (**Signup ➔ Search ➔ Hold ➔ Stream Settlement ➔ Reconciliation**).
  * `tests/concurrency/`: Multithreaded race condition verification.
* **Synthetic Race Condition Tests (`tests/concurrency/`):** Use `Promise.all()` to dispatch 50+ concurrent requests to a single seat/resource in the exact same millisecond, mathematically proving 0% overselling.
* **Test Environment Isolation (`testDb.ts`):** Maintain explicit database cleanup (`cleanDatabase()`) and seed helpers to guarantee 100% state parity across test runs. Conditionally suppress logger noise (`morgan`) during test executions.

---

## 10. Context Synchronization & AI Execution Protocol
1. **Context Check:** Always consult `PROJECT_CONTEXT.md` before generating code to verify the current **Active Phase** and system architecture.
2. **Scope Discipline:** Focus strictly on the task at hand. Do not modify working configurations or rewrite unrelated modules.
3. **Phase Update Routine:** Upon completing a phase or milestone, prompt the developer to update `PROJECT_CONTEXT.md` to keep session state perfectly synchronized.