---
name: support-engine-productization
description: >
  Architecture and productization rules for the Support Engine.
  Use when designing, implementing, refactoring or auditing
  Support Agent, Product Consultant, Order Agent,
  Review Intelligence, Agentic Memory, Customer Help,
  LLM orchestration, integrations, API contracts,
  product enrichment, embeddings or semantic search.
  Enforce platform-independent core and replaceable adapters.
---

# Support Engine Productization

## Mission

Build a reusable, independently deployable AI Support Engine.

NextShop is the first integration and testing environment.
It is NOT the architectural boundary of the product.

The Engine must integrate with different ecommerce platforms,
databases, external APIs, AI providers and client applications.

The Engine may initially run as a NestJS application.
Microservice extraction is not a requirement.

## Product boundaries

The product consists of:

1. Domain and application logic.
2. Inbound contracts for clients and integrations.
3. Outbound ports for external dependencies.
4. Replaceable adapters.
5. Engine-owned persistence and infrastructure.
6. Deployment and configuration mechanisms.

Read `architecture-contract.md` before making architectural
decisions.

Use `portability-checklist.md` during review and before
declaring implementation complete.

## Mandatory principles

### Independent core

Business logic must not directly depend on:

- NextShop domain services or database models.
- Next.js, React, Vue or other UI frameworks.
- Prisma or a specific external database.
- Qdrant or another concrete vector provider.
- A specific LLM or embedding provider.
- Shopify, WooCommerce, Bitrix or other platforms.
- NestJS controllers, HTTP request objects or decorators.

The application may use dependency injection, but framework
integration belongs outside the independent core.

### Explicit boundaries

Introduce ports where application logic interacts with
external systems or replaceable infrastructure.

Do not create interfaces for every class or method.

Internal application components may communicate directly
when they belong to the same architectural boundary.

### Canonical data

External data must be normalized into Engine-owned models.

Preserve source identifiers, tenant ownership, timestamps,
provenance and freshness information where applicable.

Do not expose external ORM models as Engine contracts.

### Bidirectional integration

Support both reading data and executing permitted operations
in external systems.

Write operations require authorization, validation,
appropriate user confirmation, idempotency and error handling.

### Frontend independence

Return structured, versioned responses.

Do not return React components, JSX, Tailwind classes,
shadcn-specific structures or presentation HTML as business
contracts.

### Provider independence

Keep LLM, embeddings, vector search and storage integrations
replaceable through explicit contracts.

Do not assume every AI function works without an LLM.
Provider independence means replaceability, not eliminating
the need for AI processing.

### Deployment independence

Support standalone deployment on a VPS or cloud environment.

Prefer a reproducible container-based deployment while
preserving the possibility of running the Node.js service
with externally managed dependencies.

### Tenant isolation

Treat tenant/store identity as an explicit security boundary.

Never allow data, memory, search results, credentials or
operations to cross tenant boundaries.

## Required workflow

For every relevant feature or refactor:

1. Inspect existing code and current contracts.
2. Identify the business capability involved.
3. Map dependencies crossing the Engine boundary.
4. Classify each dependency:
   CORE / PORT / ADAPTER / INFRASTRUCTURE / STORE-OWNED.
5. Identify existing reusable contracts and adapters.
6. Propose the smallest safe architectural change.
7. Implement only the approved scope.
8. Run focused tests and contract checks.
9. Evaluate portability using portability-checklist.md.
10. Report remaining platform coupling and migration risks.

## Existing functionality

Preserve validated behavior.

Do not rebuild working modules solely to reorganize folders.

Prefer incremental extraction using existing interfaces,
adapters and tests.

Do not change API contracts, database schemas or chat
artifacts without identifying compatibility implications.

## Parallel worktrees

Do not modify other active feature worktrees.

Do not merge, push or commit automatically unless explicitly
authorized by the user or an approved workflow.

## Mandatory output

For architectural work, report:

- Current state, with file paths and evidence.
- Target product boundary.
- Reusable components.
- Platform-specific dependencies.
- Required ports and adapters.
- Minimal implementation plan.
- Tests performed and remaining risks.
- Portability verdict: PASS / PARTIAL / FAIL / NOT VERIFIED.

Do not claim production portability without evidence.
