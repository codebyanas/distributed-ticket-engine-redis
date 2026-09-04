# 🚀 PROJECT_CONTEXT.md — System Blueprint & Active State Tracking

> **System Identity:** `distributed-ticket-engine-redis` (`EventLock Engine`)  
> **Architecture:** Distributed High-Concurrency Ticket & Seat Reservation Engine  
> **Core Stack:** TypeScript, Node.js (Express), PostgreSQL (Prisma ORM v7), Redis 7.x (`ioredis`), WebSockets, Docker Compose  
> **Scale & Performance Targets:** 1 Million+ Dataset | 20,000+ RPS Throughput | Sub-10ms p99 Latency | 0% Double-Booking Guarantee  

---

## 📌 System Architecture & Operational Overview

`EventLock Engine` is engineered to solve critical high-concurrency bottlenecks during high-demand ticket drops (e.g., FIFA tickets, Daraz 11.11, BookMe) where 100,000+ users access the platform simultaneously.

### Architectural Execution Flow:
1. **Traffic Shielding Layer (Phase 1):** Incoming HTTP requests pass through a native Redis-backed Sliding Window Log Rate Limiter (`ZSET`), blocking bot spam and brute-force traffic at the API edge with HTTP 429 before touching application logic.
2. **Cache Stampede Guard (Phase 2):** Seating map queries hit Redis. Upon TTL cache expiration, a Distributed Mutex Lock (`SET NX PX`) ensures only *one* request re-hydrates Redis from PostgreSQL, completely shielding the database from thundering herd spikes.
3. **Atomic Reservation Lock (Phase 3):** Seat selection executes an embedded C-like Lua script (`atomic_seat_lock.lua`) inside Redis. The check-and-hold operation completes in a single CPU instruction, eliminating application-level race conditions and overselling.
4. **Asynchronous Order Pipeline (Phase 4):** Upon seat hold confirmation, payment settlement and ticket generation side-effects are pushed to **Redis Streams (`XADD`)**. Decoupled background workers consume events (`XREADGROUP`) with guaranteed idempotency and crash recovery via the Pending Entries List (PEL).
5. **Real-Time Map Synchronization (Phase 5):** Multi-node WebSocket servers synchronize seat availability across all active clients using **Redis Pub/Sub as a Backplane Adapter**.
6. **Geospatial Discovery Engine (Phase 6):** Venue searches within dynamic radiuses utilize **Redis `GEOSEARCH`** for $O(\log N)$ sub-millisecond location lookups.
7. **Persistent Source of Truth:** **PostgreSQL** handles permanent ACID ledger entries, user accounts, and financial settlement records via **Prisma ORM**, safely positioned behind the Redis execution shield.

---

## 📁 Enterprise Directory Architecture

```
distributed-ticket-engine-redis/
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore rules
├── AI_RULES.md                   # AI coding constraints & enterprise rules
├── PROJECT_CONTEXT.md            # Master architecture & active state blueprint
├── README.md                     # Public documentation & benchmark matrix
├── docker-compose.yml            # Multi-container orchestration (App, Postgres, Redis)
├── redis.conf                    # Production-tuned Redis memory & eviction config
├── package.json                  # NPM dependencies & scripts
├── tsconfig.json                 # Strict TypeScript compiler options
│
├── prisma/                       # Prisma ORM & Database Layer
│   ├── schema.prisma             # PostgreSQL Models, B-Tree & GIN indexes
│   ├── migrations/               # Database SQL migration history
│   └── seed.ts                   # Seeder populating 1M+ records & 500 users
│
├── src/                          # Application Source Directory
│   ├── server.ts                 # HTTP & WebSocket Listener, Signal Handlers
│   ├── app.ts                    # Express Application Setup & Global Middlewares
│   │
│   ├── config/                   # Configuration & Environment Validation
│   │   ├── env.ts                # Zod boot-time environment schema guard
│   │   ├── redis.config.ts       # ioredis client singleton & reconnect policy
│   │   └── database.config.ts    # PrismaClient singleton instance
│   │
│   ├── routes/                   # Express API Route Declarations
│   │   ├── index.ts              # Central v1 Router aggregator
│   │   ├── ticket.routes.ts      # Seat reservation & hold endpoints
│   │   └── event.routes.ts       # Event catalog & GEO search routes
│   │
│   ├── controllers/              # HTTP Input Validation & Response Handlers
│   │   ├── ticket.controller.ts  # Reservation controller logic
│   │   └── event.controller.ts   # Event search & venue catalog handlers
│   │
│   ├── services/                 # Core Business Logic & Redis Shield Layer
│   │   ├── ticket.service.ts     # Reservation orchestrator & DB manager
│   │   ├── redis-lock.service.ts # Atomic Lua script executor for seat locks
    │   ├── stampede.service.ts   # Mutex re-hydration guard (Anti-Cache Stampede)
│   │   └── geo.service.ts        # Redis GEOSEARCH query service
│   │
│   ├── middlewares/              # Custom Express Middlewares
│   │   ├── rateLimiter.ts        # Redis ZSET Sliding Window Rate Limiter
│   │   ├── error.middleware.ts   # Centralized error handling interceptor
│   │   └── validate.middleware.ts# Request payload validator (Zod)
│   │
│   ├── scripts/                  # Redis Embedded Lua Scripts
│   │   ├── lua/
│   │   │   ├── atomic_seat_lock.lua # Check-and-set atomic reservation script
│   │   │   └── sliding_window.lua   # Rate limiting sliding window script
│   │   └── lua-loader.ts         # Script caching & SHA1 digest registry
│   │
│   ├── workers/                  # Asynchronous Stream Processing
│   │   ├── stream-consumer.worker.ts # Redis Stream consumer group handler
│   │   └── payment.worker.ts         # Settlement & email worker task
│   │
│   ├── websocket/                # Real-Time State Sync Layer
│   │   ├── socket.server.ts      # WebSocket server initialization
│   │   └── pubsub.adapter.ts     # Redis Pub/Sub backplane adapter
│   │
│   ├── types/                    # Strict TypeScript Interfaces & Contracts
│   │   ├── express.d.ts          # Express Request augmentation
│   │   ├── events.types.ts       # Redis Stream & Pub/Sub event payloads
│   │   └── ticket.types.ts       # Seat, booking, and lock DTOs
│   │
│   └── utils/                    # Common Technical Utilities
│       ├── logger.ts             # Structured logger (Winston/Pino)
│       └── custom-errors.ts      # Domain error class hierarchy
│
└── tests/                        # Automated Multi-Tier Test Suite
    ├── setup.ts                  # Test database & Redis teardown helper
    ├── unit/                     # Business logic unit tests
    ├── integration/              # API & database integration tests
    └── concurrency/              # Synthetic Race Condition Test Suite
        └── seat-lock.concurrency.test.ts
```

---

## 🏁 Master Execution Roadmap & Phase Tracker

- [ ] **Phase 1: Traffic Shielding & Bot Defense** `[STATUS: IN_PROGRESS]`
  * **Objective:** Implement a native Redis `ZSET` Sliding Window Log Rate Limiter middleware to drop abusive traffic at the API edge.
  * **Target Deliverables:** `src/middlewares/rateLimiter.ts`, `src/scripts/lua/sliding_window.lua`, `src/config/redis.config.ts`.

- [ ] **Phase 2: Database Protection & Stampede Shield** `[STATUS: NOT_STARTED]`
  * **Objective:** Build a Distributed Mutex Lock (`SET NX PX`) re-hydration guard to defend PostgreSQL against thundering herd spikes when 1M+ key caches expire.
  * **Target Deliverables:** `src/services/stampede.service.ts`, production-tuned `redis.conf` LRU memory policies.

- [ ] **Phase 3: Atomic Concurrency & Race Condition Elimination** `[STATUS: NOT_STARTED]`
  * **Objective:** Eliminate double-booking by executing check-and-hold seat locks inside atomic C-like Redis Lua scripts (`atomic_seat_lock.lua`).
  * **Target Deliverables:** `src/scripts/lua/atomic_seat_lock.lua`, `tests/concurrency/seat-lock.concurrency.test.ts`.

- [ ] **Phase 4: Decoupled Order Processing & Event Streaming** `[STATUS: NOT_STARTED]`
  * **Objective:** Decouple ticket settlement and emails from the HTTP request cycle using Redis Streams (`XADD`) and Consumer Groups (`XREADGROUP`).
  * **Target Deliverables:** `src/workers/stream-consumer.worker.ts`, strongly-typed event contracts in `src/types/events.types.ts`.

- [ ] **Phase 5: Real-Time Seating Map Synchronization** `[STATUS: NOT_STARTED]`
  * **Objective:** Synchronize seat state changes across multi-container WebSocket servers using Redis Pub/Sub as a Backplane Adapter.
  * **Target Deliverables:** `src/websocket/pubsub.adapter.ts`, `src/websocket/socket.server.ts`.

- [ ] **Phase 6: Geospatial Concert Search Engine** `[STATUS: NOT_STARTED]`
  * **Objective:** Implement sub-millisecond location-based venue search filtering within dynamic radius using Redis `GEOSEARCH`.
  * **Target Deliverables:** `src/services/geo.service.ts`, `src/routes/event.routes.ts`.

- [ ] **Phase 7: Load Testing, Benchmarking & Production Packaging** `[STATUS: NOT_STARTED]`
  * **Objective:** Orchestrate PostgreSQL, Redis, and Express in `docker-compose.yml` and generate p95/p99 latency benchmarks under 20k+ RPS using `autocannon`.
  * **Target Deliverables:** `docker-compose.yml`, performance metrics matrix in `README.md`.

---

## 🎯 Current Active Milestone Focus

**Active Milestone:** **Phase 1 — Project Initialization & Traffic Shielding**
* **Active Tasks:**
  1. Initialize project files (`package.json`, `tsconfig.json`, `docker-compose.yml`, `redis.conf`).
  2. Implement Zod boot-time environment validation (`src/config/env.ts`).
  3. Setup singleton Redis client connection pool (`src/config/redis.config.ts`) and Prisma client (`src/config/database.config.ts`).
  4. Develop Redis `ZSET` Sliding Window Rate Limiting middleware (`src/middlewares/rateLimiter.ts`).

---

## 🔄 Context Synchronization & Phase Transition Protocol

1. **Single Focus Rule:** All code generations and modifications must strictly address the active phase tasks defined above.
2. **AI Rules Compliance:** All implementations MUST strictly adhere to `AI_RULES.md` (Strict TypeScript, English comments, mandatory JSDoc blocks, no `any` types, atomic operations).
3. **Phase Update Trigger:** Upon completing Phase 1:
   * Update this `PROJECT_CONTEXT.md` file to mark Phase 1 as `[STATUS: COMPLETED]`.
   * Transition Phase 2 to `[STATUS: IN_PROGRESS]`.
   * Update the **Current Active Milestone Focus** block to Phase 2 objectives.