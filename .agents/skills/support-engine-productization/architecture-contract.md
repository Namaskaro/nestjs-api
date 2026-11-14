# Support Engine — Architecture Contract

## 1. Product definition

Support Engine is an independent server-side AI application.

It processes customer conversations, product information,
reviews, orders, knowledge, memory and related operations.

It exposes stable interfaces to arbitrary client applications.

It integrates with external commerce platforms through
replaceable adapters.

NextShop is a reference integration, not a required dependency.

Этот контракт обязателен для всех модулей Support Engine. Унаследованные
отклонения фиксируются в аудите и исправляются постепенно в утверждённом
scope, с сохранением проверенного поведения и совместимости NextShop.

## 2. Architectural layers

### Domain / Core

Contains technology-independent:

- Business rules and policies.
- Domain entities and value objects.
- Canonical domain models.
- Decision logic and invariants.

### Application

Contains reusable use cases and orchestration:

- Request routing.
- Product consultation.
- Product enrichment workflows.
- Recommendation generation.
- Review intelligence.
- Agentic memory.
- Order assistance.
- Customer help.
- Conversation management.

Application services depend on port contracts, not concrete
external implementations.

CORE определяет правила и инварианты; APPLICATION собирает сценарии и
выбирает разрешённые операции. PORT описывает потребности этих слоёв
на языке Engine: входы, результаты, возможности, ошибки и гарантии.
CORE/APPLICATION могут импортировать собственные модели и порты.
Конкретные реализации подключаются в точке сборки (composition root).
Название папки или наличие интерфейса не доказывают границу: проверяй
транзитивные импорты и фактический путь выполнения.

### Inbound adapters

Examples:

- REST API.
- SSE or WebSocket transport.
- Webhook receivers.
- Background job consumers.
- Other supported client transports.

They translate incoming requests into application commands
and translate responses into public contracts.

### Outbound adapters

Examples:

- NextShop integration.
- Shopify integration.
- WooCommerce integration.
- Bitrix integration.
- REST or GraphQL integration.
- Direct SQL integration when appropriate.
- LLM and embedding providers.
- Storage and vector-search providers.

### Infrastructure

Examples:

- Engine PostgreSQL.
- Qdrant.
- Redis, when required.
- Queues and workers.
- Logging, metrics and tracing.
- Configuration and secrets management.

Infrastructure is not part of the pure domain core.

ADAPTER переводит между контрактом и протоколом, схемой или SDK;
INFRASTRUCTURE предоставляет среду исполнения, хранение и эксплуатационные
механизмы. NestJS, LangGraph, Prisma, Qdrant SDK и Socket.IO могут оставаться
частью поддерживаемого профиля. Их типы, состояния и ошибки не становятся
моделями CORE, переносимыми сценариями APPLICATION или публичным wire-форматом.

## 3. Engine-owned capabilities

The following capabilities must be portable:

- Conversation orchestration and routing.
- Product search and consultation.
- Semantic enrichment and indexing workflows.
- Review analysis and summarization.
- Evidence-based Q&A.
- Recommendation reasoning.
- Episodic memory and user context.
- Order-assistance workflows.
- Knowledge retrieval and answer generation.

Each capability should expose stable application contracts.

Do not automatically make every capability a microservice.

## 4. External ownership

External commerce systems remain authoritative for:

- Products, variants and SKU identifiers.
- Prices and inventory.
- Original customer reviews.
- Orders and their authoritative states.
- Payments and refunds.
- Shipment and delivery records.
- Customer commerce accounts.
- Авторитетные правила совместимости, цены и изменения сборки
  в конфигураторе магазина, если такая интеграция входит в scope.

The Engine may maintain normalized projections, caches,
search indexes and derived intelligence.

Derived data must retain traceability to its source.

STORE-OWNED описывает владельца данных и решений, даже когда адаптер
встроен в тот же процесс. Engine владеет диалогами, принятыми решениями,
своими проекциями и производным состоянием в пределах своего контракта.
Совпадающие внешние ID разных магазинов должны оставаться различимыми.

## 5. Canonical models

Define platform-neutral models based on actual requirements.

Examples:

- TenantRef
- ExternalCustomerRef
- Product
- ProductVariant
- ProductCategory
- ProductAttributes
- ProductReview
- Order
- OrderItem
- Shipment
- Conversation
- ConversationEpisode
- ReviewEvidence
- RecommendationResult

Do not assume all platforms have identical attributes.

Use explicit mappings, optional fields and capability
declarations where required.

Avoid creating a universal schema containing every possible
field from every commerce provider.

## 6. Integration contracts

Create ports based on capabilities, not technologies alone.

Illustrative contracts:

- ProductCatalogPort
- ProductDetailsPort
- ReviewSourcePort
- OrderQueryPort
- OrderCommandPort
- CustomerIdentityPort
- StoreKnowledgePort
- LlmPort
- EmbeddingPort
- VectorSearchPort
- MemoryRepositoryPort

These are candidate boundaries, not mandatory interface names.

Reuse existing compatible ports.

Separate reads from operations that change external state.

All external requests must carry trusted tenant context.

Опиши для порта область доверия, формат и namespace внешних идентификаторов,
авторитетность и свежесть, пагинацию, семантику ошибок и отсутствие
возможностей. Обозначь обязательные и опциональные операции. Для записей
определи права, подтверждение, ключ идемпотентности, конфликт версий
и исход при неопределённом результате. Не предполагается общая транзакция
Engine с внешним API; гарантии каждой стороны должны быть проверяемы.

## 7. Data ingestion and synchronization

Support appropriate integration modes:

- On-demand API reads.
- Batch imports.
- Periodic incremental synchronization.
- Webhooks or events, when supported.

Use the mechanism appropriate to the source.

Normalize data before business processing.

Support:

- External ID mapping.
- Incremental updates.
- Source timestamps and revision tracking.
- Deduplication and idempotency.
- Defined failure and recovery behavior; retries only where approved.
- Deletion and publication-state changes.
- Reindexing affected derived data.

Do not require a full catalog import for every chat request.

## 8. Product enrichment and semantic search

Product Intelligence belongs to the Engine.

It may:

1. Read external product data.
2. Normalize attributes and product variants.
3. Enrich available product information.
4. Generate embeddings.
5. Build and update semantic search indexes.
6. Retrieve relevant product candidates.
7. Verify critical source facts when needed.

Embedding generation is exposed through a provider port.

Vector indexing and retrieval use a replaceable search port.

Qdrant is the initial supported adapter, not a domain
dependency.

Do not treat LLM-generated attributes as verified catalog
facts without an explicit validation policy.

## 9. Review Intelligence

Review Intelligence contains:

- Review normalization.
- Evidence selection and validation.
- Statistical interpretation.
- Review summarization.
- Review-based Q&A.
- Recommendation evidence generation.

External review retrieval must use a replaceable source port.

Store-specific publication and moderation operations remain
in the commerce integration unless explicitly owned by the
Engine.

Review evidence must preserve original source references.

Deleted, unpublished or revoked reviews must not continue
to be presented as valid evidence.

Generated summaries and indexes must support invalidation
or rebuilding when underlying reviews change.

## 10. Agentic Memory

Agentic Memory is an Engine-owned capability.

It must not require a NextShop-specific User or Chat model.

Use stable Engine identities with mappings to external
customer identities.

Keep episodic memory, confirmed preferences and their
lifecycle rules independent from commerce storage.

Preserve retention, deletion, correction and consent rules.

Prevent cross-tenant memory access.

Store-originated events are optional integrations and must
not be assumed to exist for every commerce platform.

Для User Context та же граница идентичности обязательна. Отделяй
текущий диалог, эпизоды и подтверждённый устойчивый профиль. Не переноси
вывод модели или сигнал магазина в подтверждённый профиль без утверждённых
правил, явного основания и возможности отзыва.

## 11. Order Agent

Order Agent owns conversational order-assistance logic.

The commerce platform owns authoritative order operations.

Use query and command ports to:

- Retrieve customer orders.
- Resolve a target order.
- Interpret order states.
- Request a permitted cancellation.
- Return operation outcomes.

Use the existing OrderPort and CurrentStoreOrderAdapter as
starting points for boundary analysis.

Do not assume every platform supports cancellation,
refunds or shipment updates through the same API.

Check permissions and platform capabilities.

Require confirmation when appropriate.

Protect state-changing operations against duplicate execution.

## 12. Public API and frontend independence

The Engine exposes versioned public contracts.

Illustrative capabilities:

- Create or resume a conversation.
- Send a customer message.
- Receive streamed status and response events.
- Retrieve structured artifacts.
- Confirm or reject a proposed operation.
- Retrieve conversation context where permitted.

Public responses contain structured data, such as:

- Message text.
- Product references.
- Recommendation rationale.
- Review evidence.
- Rating statistics.
- Comparison criteria.
- Operation proposals and results.
- Machine-readable event types.

Next.js, React, Vue, Angular and native clients render these
contracts using their own UI implementations.

Tailwind, shadcn/ui and Lucide are implementation details
of the current NextShop frontend.

Версионируй публичный wire-контракт (команды, ответы, события, ошибки и
артефакты), отдельно от версии транспорта, DTO хоста и Swagger-метаданных.
Задай политику совместимости: обязательные/опциональные поля, неизвестные
типы событий, миграция при несовместимых изменениях. Документируй
корреляцию, подтверждение приёма, повторную доставку и reconnect/replay
там, где они обещаны. Поддерживаемый Socket.IO может остаться входным
адаптером. Доказывай работу независимым клиентом без UI NextShop.

## 13. Storage and deployment

The Engine may own its operational data.

Initial deployment profile:

- Node.js application.
- PostgreSQL for canonical Engine persistence.
- Qdrant for semantic indexing.
- Redis only for capabilities that require it.
- Background workers where necessary.

Support Docker Compose as an initial deployment method.

Allow external managed database/vector services through
configuration where supported.

A future single-container or SaaS deployment is optional.

Supporting external PostgreSQL/MySQL commerce databases
does not require the Engine's own persistence to support
every SQL dialect.

В профиле поставки отдельно указывай обязательные Engine PostgreSQL,
векторный индекс, очереди и другие зависимости с поддерживаемыми версиями.
Приложение обращается к своему состоянию по контрактам Engine; конкретный
драйвер и миграции принадлежат инфраструктуре. Второй магазин может
передавать данные через API, feed или события независимо от своей СУБД.
Для доказательства переносимости не требуется второй движок хранения
внутреннего состояния.

## 14. Tenant isolation and security

Every request must resolve a trusted tenant identity.

Apply tenant isolation to:

- Conversations and memory.
- Product projections and vector indexes.
- Review evidence.
- Background jobs.
- Cache entries.
- Configuration and secrets.
- External operations.
- Keys of checkpoints, idempotency and reconnect/replay state.

Authenticate inbound integrations.

Authorize customer-specific reads and writes.

Do not trust arbitrary tenantId or userId values supplied
by an untrusted client.

Avoid exposing commerce credentials to the frontend.

Protect sensitive customer data and support its deletion.

## 15. Productization strategy

Incremental migration is mandatory.

Preferred sequence:

1. Audit current coupling.
2. Define and verify domain boundaries.
3. Extract existing reusable interfaces and logic.
4. Add adapters at necessary boundaries.
5. Preserve existing functionality and contracts.
6. Prove portability with an alternative adapter.
7. Package and validate standalone deployment.

Do not extract microservices before a real operational
requirement justifies them.

Do not build integrations for every commerce platform
without an approved business requirement.

## 16. Доказательство переносимости и выпуска

Один и тот же контрактный набор обязателен для рабочего адаптера и
независимой реализации затронутого порта. Меняться могут маппинг,
конфигурация и wiring; CORE и APPLICATION остаются теми же. Независимый
источник имеет собственные raw-поля, ID, возможности и поведение ошибок.
Проверяй сценарий до результата и эффекта, включая границу tenant,
недоступность, повтор и обновление/удаление, когда они применимы.
Мок, возвращающий готовые канонические записи, полезен для unit-тестов.
Сам по себе он не проходит критерий независимого адаптера.

Синтетический источник с собственной моделью может закрыть
`PORTABILITY_GATE` в проверенных границах. Для поддержки реального
поставщика проверяй его API в разрешённой среде, включая аутентификацию,
права, форматы, сценарии отказов, ограничения и побочные эффекты.
Состояние `production-ready` допустимо только для конкретного кандидата
и профиля после `RELEASE_GATE: PASS`. Операционные критерии и разница
с `MILESTONE_GATE` описаны в [чек-листе](portability-checklist.md).
