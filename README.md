# 🎟️ EventLock Engine (`distributed-ticket-engine-redis`)

> **A high-throughput, distributed ticket reservation engine built with TypeScript, PostgreSQL, and Redis — engineered to query 1M+ records at 20k+ RPS, eliminate double-booking via Atomic Lua Scripts, and protect DBs from Cache Stampedes.**

---

## 📌 Executive Summary & Core Problem

During high-concurrency flash sales and ticket drops (e.g., FIFA tickets, Daraz 11.11, BookMe), platforms experience massive traffic spikes exceeding **100,000+ requests per second**. Traditional relational databases (PostgreSQL/MySQL) fail under this load due to connection pool exhaustion and locking overhead.

### Key Failures in Standard Architectures:
1. **Database Crash (Connection Pool Exhaustion):** Thousands of concurrent read/write queries saturate database thread pools, dropping the system entirely.
2. **Double-Booking & Overselling (Race Conditions):** Multi-step `SELECT`-then-`UPDATE` application logic allows two parallel threads to lock and purchase the exact same seat simultaneously.
3. **High Latency & Thundering Herd:** Expired cache keys trigger thousands of concurrent database re-queries at the exact same millisecond (**Cache Stampede**), driving response times to 5–10 seconds.

### The Solution Architecture
`EventLock Engine` decouples heavy execution from disk reads by utilizing **PostgreSQL as the primary persistent data source (1M+ records)** and **Redis as an In-Memory Execution Shield, Distributed Lock Manager, and Event Stream Processor**.

```
[Incoming Traffic: 20k+ RPS]
          │
          ▼
┌───────────────────────────────────┐
│  Phase 1: API Gateway & Bot Shield│ ──> (Redis ZSET Sliding Window Rate Limiter)
└───────────────────────────────────┘
          │
          ▼
┌───────────────────────────────────┐
│ Phase 2: Stampede Protection Layer│ ──> (Redis SET NX Mutex Lock + Cache Re-hydration)
└───────────────────────────────────┘
          │
          ▼
┌───────────────────────────────────┐
│ Phase 3: Atomic Lock Execution    │ ──> (Embedded Redis Lua Script - 1 CPU Instruction)
└───────────────────────────────────┘
          │
          ├─────────────────────────┐
          ▼                         ▼
┌────────────────────┐   ┌────────────────────────────────────┐
│ PostgreSQL Primary │   │ Phase 4: Async Pipeline (Streams)   │
│ (1M+ Safe Records) │   │ (BullMQ / Redis Consumer Groups)   │
└────────────────────┘   └────────────────────────────────────┘
```

---

## 🛠 Tech Stack & Core Infrastructure

* **Language & Runtime:** TypeScript, Node.js (v20+)
* **Primary Database:** PostgreSQL (1M+ persistent records, ACID Transactions)
* **In-Memory Store & Compute:** Redis 7.x (`ioredis` client)
* **Framework:** Express.js
* **Event Streaming & WebSockets:** Redis Streams, Redis Pub/Sub, `ws`
* **Testing & Benchmarking:** Jest (Concurrency Testing), `autocannon` / `k6`
* **Infrastructure & Containerization:** Docker, Docker Compose, Custom `redis.conf`

---

## 🛣️ 7-Phase Master Architectural Blueprint

### Phase 1: Traffic Shielding & Bot Protection
* **Problem Solved:** Automated bots flood API endpoints, exhausting application threads before business logic executes.
* **Mechanism:** Sliding Window Log Algorithm using Redis Sorted Sets (`ZSET`) and atomic Multi-Exec Pipelines (`multi()`, `exec()`). Excess traffic is dropped at the API layer with HTTP 429 (*Too Many Requests*).
* **Key Redis Skills:** `ZSET` range queries, Redis Pipelines, Microsecond-level Window Truncation.

### Phase 2: Database Protection, Stampede Shield & Memory Management
* **Problem Solved:** **Cache Stampede (Thundering Herd)**. When the seating map cache (5-min TTL) expires, 20,000 parallel requests hit PostgreSQL simultaneously.
* **Mechanism:** Implements a **Distributed Mutex Lock (`SET key value NX PX`)**. Only *one* request obtains the lock to re-hydrate Redis from PostgreSQL, while remaining requests wait and read from the newly hydrated Redis cache.
* **Key Redis Skills:** Custom `redis.conf` memory management, Eviction Policies (`volatile-lru`), Persistence Modes (RDB vs. AOF tuning), Cache-Aside Re-hydration Guard.

### Phase 3: Atomic Concurrency, Lua Scripting & Race Condition Elimination
* **Problem Solved:** **Double-Booking / Overselling**. Parallel API calls inspecting seat availability simultaneously result in multiple users reserving the same seat.
* **Mechanism:** Bypasses Node.js application-level `if-else` checks by executing an **Embedded C-like Lua Script** inside Redis (`redis.eval()`). Redis executes the script atomically in a single CPU instruction, guaranteeing 0% race conditions.
* **Key Redis Skills:** Embedded Lua Scripting, Single-Threaded Atomic Guarantees, Non-blocking Check-and-Set Locks.

### Phase 4: Decoupled Order Processing, Event Streaming & Strict Typing
* **Problem Solved:** Synchronous processing bottlenecks. Processing payments, sending emails, and generating PDF tickets directly inside the HTTP request cycle causes cascade failures.
* **Mechanism:** Upon seat reservation, the API immediately returns HTTP 200 and emits an event to **Redis Streams (`XADD`)**. Background workers organized in **Consumer Groups (`XREADGROUP`)** process orders asynchronously.
* **Key Redis Skills:** Redis Streams, Consumer Group Load Balancing, Pending Entries List (PEL) for worker crash recovery, Strict TypeScript Event Schemas.

### Phase 5: Real-Time Seating Map Sync & Backplane Architecture
* **Problem Solved:** State Desynchronization. When User A reserves Seat #A15, all other connected clients must see Seat #A15 turn "Red / Reserved" in real time.
* **Mechanism:** Binds multi-node WebSocket server instances using **Redis Pub/Sub as a Backplane Adapter**. State changes broadcast across all Docker containers instantly.
* **Key Redis Skills:** Redis Pub/Sub (`PUBLISH`/`SUBSCRIBE`), Distributed State Sync, WebSocket Backplane Scaling.

### Phase 6: Geospatial Concert Search Engine
* **Problem Solved:** High-latency spatial SQL queries (`LAT/LNG` boundary scans) on 1M+ database records.
* **Mechanism:** Indexes venue coordinates using **Redis Geospatial Data Structures (`GEOADD`)**. Queries nearby concerts within a 10km radius in $O(\log N)$ time complexity using `GEOSEARCH`.
* **Key Redis Skills:** Spatial Indexing, GeoHash Mechanics, Sub-millisecond Spatial Filtering.

### Phase 7: Load Testing, Benchmarking & Production Orchestration
* **Problem Solved:** Unverified system limits and deployment inconsistencies.
* **Mechanism:** Bundles Node.js Services, PostgreSQL, and Redis into a single `docker-compose.yml`. Executes high-concurrency load tests via `autocannon` / `k6` at 20,000+ RPS to generate p50, p95, and p99 latency reports.
* **Key Redis Skills:** Container Orchestration, Production Profiling, Latency Benchmarking.

---

## 📊 Phase-Wise Deliverables & Skills Matrix

| Phase | Core Mechanism | Redis Pattern / Tool | Integrated Market Skill | Primary Deliverable |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Rate Limiting | `ZSET` + Sliding Window | Native Express Middleware | API Bot Defense Middleware |
| **2** | Stampede Protection | `SET NX` Mutex + TTL | `redis.conf` LRU Memory Tuning | High-Traffic Layout Cache Engine |
| **3** | Race Condition Lock | Atomic Lua Script | **Jest Concurrency Testing** | Zero Overselling Lock Engine |
| **4** | Async Pipeline | Redis Streams + Groups | **Strict TypeScript Event Types** | Event-Driven Worker Pipeline |
| **5** | Real-Time Sync | Pub/Sub + WebSockets | Backplane State Architecture | Live Dynamic Seating Map Sync |
| **6** | Radius Search | `GEOSEARCH` | GeoHash Spatial Indexing | Sub-millisecond Venue Finder |
| **7** | Production Ready | Docker + Benchmarking | **Docker Compose & `autocannon`** | Load Tested Engine + Repo |

---

## 📁 Directory Structure

```
distributed-ticket-engine-redis/
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore rules
├── AI_RULES.md                   # AI coding standards & constraints
├── PROJECT_CONTEXT.md            # System architecture & active phase tracking
├── README.md                     # Project documentation & benchmark matrix
├── docker-compose.yml            # Multi-container orchestration (App, Postgres, Redis)
├── redis.conf                    # Custom production-tuned Redis configuration
├── package.json                  # NPM dependencies & scripts
├── tsconfig.json                 # TypeScript compiler configuration
│
├── prisma/                       # Prisma ORM Database Directory
│   ├── schema.prisma             # PostgreSQL Schema models & indexes
│   ├── migrations/               # SQL Migration history
│   └── seed.ts                   # Database seeder script (1M mock records)
│
├── src/                          # Application Source Code
│   ├── server.ts                 # HTTP & WebSocket Server entry point (Port Listener)
│   ├── app.ts                    # Express app initialization, CORS, global middlewares
│   │
│   ├── config/                   # Infrastructure Connections & Environment Parsing
│   │   ├── env.ts                # Strictly typed environment variables schema (Zod/Joi)
│   │   ├── redis.config.ts       # ioredis client initialization & cluster settings
│   │   └── database.config.ts    # Prisma client singleton instance
│   │
│   ├── routes/                   # API Route Definitions
│   │   ├── index.ts              # Global v1 router aggregator
│   │   ├── ticket.routes.ts      # Seat hold, reservation, and booking routes
│   │   └── event.routes.ts       # Event catalog and geo-location search routes
│   │
│   ├── controllers/              # Request Handlers (HTTP Input Validation & Response)
│   │   ├── ticket.controller.ts  # Ticket reservation HTTP endpoints
│   │   └── event.controller.ts   # Event listing & venue search endpoints
│   │
│   ├── services/                 # Core Business Logic & In-Memory Shield Operations
│   │   ├── ticket.service.ts     # Reservation business rules & DB orchestrator
│   │   ├── redis-lock.service.ts # Atomic Lua script execution wrapper for seat locking
│   │   ├── stampede.service.ts   # Mutex re-hydration guard logic (Anti-Cache Stampede)
│   │   └── geo.service.ts        # Redis GEOSEARCH query implementations
│   │
│   ├── middlewares/              # Express Middlewares
│   │   ├── rateLimiter.ts        # Redis ZSET Sliding Window Rate Limiting middleware
│   │   ├── error.middleware.ts   # Global error handling middleware
│   │   └── validate.middleware.ts# Request payload validation middleware
│   │
│   ├── scripts/                  # Redis Embedded Lua Scripts (.lua files)
│   │   ├── lua/
│   │   │   ├── atomic_seat_lock.lua # Check-and-set atomic reservation script
│   │   │   └── sliding_window.lua   # Rate limiting sliding window script
│   │   └── lua-loader.ts         # Script caching & SHA1 digest registry
│   │
│   ├── workers/                  # Asynchronous Background Processing
│   │   ├── stream-consumer.worker.ts # Redis Stream event consumer (XREADGROUP)
│   │   └── payment.worker.ts         # Asynchronous order settlement & PDF/Email worker
│   │
│   ├── websocket/                # Real-Time Synchronization Layer
│   │   ├── socket.server.ts      # WebSocket server instance (ws / socket.io)
│   │   └── pubsub.adapter.ts     # Redis Pub/Sub backplane adapter for multi-node sync
│   │
│   ├── types/                    # Strict TypeScript Interfaces & Contracts
│   │   ├── express.d.ts          # Custom Express Request type definitions
│   │   ├── events.types.ts       # Redis Stream & Pub/Sub payload interfaces
│   │   └── ticket.types.ts       # Seat status, booking, and lock DTOs
│   │
│   └── utils/                    # Shared Technical Utilities
│       ├── logger.ts             # Structured logger (Winston / Pino)
│       └── custom-errors.ts      # Custom error classes (AppError, ConflictError)
│
└── tests/                        # Comprehensive Testing Suite
    ├── setup.ts                  # Test environment initialization & DB teardown
    ├── unit/                     # Business logic unit tests
    ├── integration/              # API endpoint integration tests
    └── concurrency/              # Multithreaded Race Condition Tests (Promise.all)
        └── seat-lock.concurrency.test.ts
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js:** v20.x or higher
* **Docker Desktop:** Installed and running

### 1. Clone & Install
```bash
git clone [https://github.com/your-username/distributed-ticket-engine-redis.git](https://github.com/your-username/distributed-ticket-engine-redis.git)
cd distributed-ticket-engine-redis
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
PORT=3000
NODE_ENV=development

# PostgreSQL Config
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=admin
POSTGRES_PASSWORD=secret
POSTGRES_DB=eventlock_db

# Redis Config
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Spin Up Infrastructure (Postgres + Redis)
```bash
docker compose up -d
```

### 4. Run Development Server
```bash
npm run dev
```

### 5. Run Automated Concurrency Tests
Execute parallel race condition tests simulating 50 concurrent requests hitting a single seat simultaneously:
```bash
npm run test:concurrency
```

### 6. Run High-Concurrency Load Benchmark
Simulate 20,000 RPS using `autocannon`:
```bash
npm run benchmark
```

---

## 📜 License
This project is licensed under the [MIT License](LICENSE).