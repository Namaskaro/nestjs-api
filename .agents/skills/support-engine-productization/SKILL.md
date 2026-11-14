---
name: support-engine-productization
description: >
  Architecture and productization rules for the Support Engine.
  Use when designing, implementing, refactoring or auditing
  Support Agent, Product Consultant, Order Agent,
  Review Intelligence, Agentic Memory, User Context, Customer Help,
  routing, LLM orchestration, integrations, client contracts,
  product enrichment, embeddings, search, persistence or deployment.
  Enforce platform-independent core and replaceable adapters.
---

# Support Engine Productization

## Mission

Build a reusable, independently deployable AI Support Engine.

NextShop is the first integration and testing environment.
It is NOT the architectural boundary of the product.

The Engine must integrate with different ecommerce platforms,
external data sources, AI providers and client applications.
Переносимость обязательна для всех текущих и будущих модулей.
Совместимость разных внешних источников не требует нескольких СУБД
для внутреннего состояния Engine. PostgreSQL допустим как профиль поставки.

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

Прочитай [architecture-contract.md](architecture-contract.md) перед
проектированием. Используй [portability-checklist.md](portability-checklist.md)
при планировании и проверке, в том числе для существующего модуля.
[Discovery текущей архитектуры](discovery-2026-11-14.md) — датированный
снимок с примерами; актуальное состояние устанавливай по коду.

## Mandatory principles

### Independent core

Business logic must not directly depend on:

- NextShop domain services or database models.
- Next.js, React, Vue or other UI frameworks.
- Prisma or a specific database client, schema or generated storage types.
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

Для каждой затронутой возможности:

1. Зафиксируй worktree, HEAD и состояние индекса. Проследи активный путь
   от запроса или события до эффекта. Отметь абстракции, которые есть в коде,
   но не участвуют в этом пути.
2. Классифицируй зависимости: CORE / APPLICATION / PORT / ADAPTER /
   INFRASTRUCTURE / STORE-OWNED. Укажи владение данными, адаптеры по умолчанию,
   обязательные и опциональные возможности и риск для существующего клиента.
3. В плане задай инварианты, границы замены, матрицу тестов и критерии gates.
   Используй существующие контракты и вноси только согласованные изменения.
   Унаследованные связи фиксируй как долг с ограничениями и следующим шагом;
   их наличие не расширяет scope и не оправдывает ложный PASS.
4. В `REUSABLE_PRODUCT` оцени gates отдельно по чек-листу:
   - `MILESTONE_GATE`: поведение этапа и регрессии подтверждены в его границах.
   - `PORTABILITY_GATE`: один набор контрактных проверок прошёл с действующим
     и независимым адаптерами того же порта без правок CORE / APPLICATION.
   - `RELEASE_GATE`: кандидат, профиль поставки и заявленные интеграции
     проверены в эксплуатации, включая установку, безопасность, обновление
     и восстановление. Требуются PASS всех применимых обязательных критериев.
5. Зафиксируй отдельно статус, ревизию, подтверждение и ограничения каждого
   gate в `STATE.md` или отчёте. Прохождение этапа разработки, дизайн-ревью
   или сквозного сценария NextShop не повышает статус остальных gates.

Контрактное тестирование независимого адаптера обязательно для каждой
затронутой внешней границы перед её признанием переносимой. Синтетический
источник с иной моделью данных допустим для `PORTABILITY_GATE`. Интеграция
с реальным магазином требует отдельной проверки его API, прав, данных,
операций и эксплуатационных ограничений. Стенд или мок этого не доказывают.

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
- Раздельные статусы gates и границы доказанной поддержки.

Используй `production-ready` только при `RELEASE_GATE: PASS` для указанного
кандидата, профиля и списка интеграций. Статус не разрешает сам выпуск.
