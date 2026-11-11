# Support Engine — Portability Checklist

## Purpose

Evaluate whether a Support Engine capability is genuinely
reusable outside NextShop.

Do not equate passing unit tests with product readiness.

For every check record:

- PASS
- FAIL
- NOT VERIFIED
- NOT APPLICABLE

Include evidence: files, interfaces, tests or runtime results.

## A. Core independence

- [ ] Domain rules do not import NextShop services or models.
- [ ] Application logic does not depend on concrete adapters.
- [ ] Core contracts do not expose Prisma-generated types.
- [ ] Core does not depend on frontend frameworks.
- [ ] Core does not depend on NestJS transport objects.
- [ ] LLM integration is replaceable.
- [ ] Embedding integration is replaceable.
- [ ] Vector-search integration is replaceable.
- [ ] Infrastructure errors are mapped to application-level
      outcomes where appropriate.

## B. External integrations

- [ ] External system boundaries are identified.
- [ ] Required outbound ports are defined.
- [ ] Existing compatible ports are reused.
- [ ] External data is converted to canonical models.
- [ ] External IDs are preserved and correctly mapped.
- [ ] Missing or unsupported source capabilities are handled.
- [ ] Source synchronization supports updates and deletions.
- [ ] Source freshness and provenance are tracked where needed.
- [ ] External write operations are authorized.
- [ ] State-changing operations have appropriate idempotency
      and error-recovery handling.

## C. Client independence

- [ ] Public responses are structured and versioned.
- [ ] Responses do not require Next.js or React.
- [ ] UI components do not define domain contracts.
- [ ] Chat session and message flows are transport-neutral.
- [ ] Streaming events have documented semantics.
- [ ] Error contracts are consistent.
- [ ] Client actions are validated by the server.

## D. Data and infrastructure

- [ ] Engine-owned data is separate from commerce source data.
- [ ] PostgreSQL dependencies stay outside the pure core.
- [ ] Qdrant dependencies stay outside the pure core.
- [ ] Optional infrastructure is documented.
- [ ] Tenant isolation applies to persistence and search.
- [ ] Secrets and provider configuration are externalized.
- [ ] Background jobs support retries and recovery.
- [ ] Data lifecycle and deletion requirements are defined.
- [ ] The capability can run without the NextShop frontend.

## E. AI processing

- [ ] LLM-specific request/response formats stay in adapters.
- [ ] Models can be replaced without rewriting domain logic.
- [ ] Embedding models and index versions are tracked.
- [ ] Reindexing or migration strategy is documented.
- [ ] Generated claims retain appropriate source evidence.
- [ ] Unavailable AI providers produce defined failures
      or supported fallback behavior.
- [ ] No hidden dependency on test-only LLM behavior exists.

## F. Capability-specific checks

### Product Consultant

- [ ] Product retrieval uses replaceable integrations.
- [ ] Catalog enrichment is independent of the source DB.
- [ ] Product variants and attributes use canonical mappings.
- [ ] Search results respect tenant and source freshness.

### Review Intelligence

- [ ] Review retrieval is not tied to NextShop Prisma services.
- [ ] Evidence includes verifiable source references.
- [ ] Review publication changes invalidate affected results.
- [ ] Summaries and Q&A support different review providers.
- [ ] Frontend cards consume public structured artifacts.

### Agentic Memory

- [ ] Memory does not require NextShop-specific User/Chat types.
- [ ] External customer identity mapping is explicit.
- [ ] Retention and deletion work independently of the store.
- [ ] Memory is isolated by tenant and authorized user.
- [ ] Store-originated events are optional, not mandatory.

### Order Agent

- [ ] Order business logic uses application ports.
- [ ] Store-specific order states are mapped explicitly.
- [ ] External mutations use command adapters.
- [ ] Permissions and confirmation rules are enforced.
- [ ] Unsupported operations fail safely.

## G. Required verification

Perform focused verification appropriate to the change.

At minimum:

1. Identify the current real adapter.
2. Verify the capability against a fake adapter.
3. Check that swapping adapters requires no core change.
4. Verify the relevant public contract.
5. Verify tenant isolation when applicable.
6. Verify error handling and source-data edge cases.

For broader productization milestones, validate with a
second independent integration implementation.

Do not create redundant test suites without justification.

Reuse existing integration and contract-test infrastructure.

## H. Final report

Report:

Capability:
Current implementation:
Examined files:
Existing ports:
Existing adapters:
Missing boundaries:
NextShop-specific dependencies:
Breaking-change risks:
Required migration work:
Tests and evidence:
Remaining limitations:

Final verdict:
PASS / PARTIAL / FAIL / NOT VERIFIED

A capability is not fully productized merely because it
has interfaces or runs successfully in NextShop.

Productization requires verified architectural independence.
