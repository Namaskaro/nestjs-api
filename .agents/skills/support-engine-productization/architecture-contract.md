# Support Engine — Architecture Contract

## 1. Product definition

Support Engine is an independent server-side AI application.

It processes customer conversations, product information,
reviews, orders, knowledge, memory and related operations.

It exposes stable interfaces to arbitrary client applications.

It integrates with external commerce platforms through
replaceable adapters.

NextShop is a reference integration, not a required dependency.

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

The Engine may maintain normalized projections, caches,
search indexes and derived intelligence.

Derived data must retain traceability to its source.

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
- Retry and failure recovery.
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

## 16. Definition of portability

A capability is portable when:

- Its core does not import NextShop-specific implementations.
- Its external dependencies are expressed as contracts.
- It works with a test implementation of its external ports.
- External data is mapped into canonical Engine models.
- Its public output is not tied to a frontend framework.
- Its tenant and security boundaries are enforced.
- It does not require changes to its core when replacing
  one compatible external adapter with another.

The final product goal is to connect a second independent
commerce platform without rewriting Engine business logic.
