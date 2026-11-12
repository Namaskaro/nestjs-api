# Project Instructions

## Project Context

This repository contains the NestJS backend of an e-commerce
application with AI-powered customer support.

Main technologies:

- TypeScript
- NestJS
- Prisma
- PostgreSQL
- Redis
- LangChain / LangGraph
- Qdrant

The existing codebase is the source of truth.
Do not assume that documentation or historical reports reflect
the current implementation.

## Communication

- Communicate with the user in Russian.
- Explain important architectural decisions in Russian.
- Keep technical identifiers, file paths, and API names unchanged.
- Write documentation in Russian unless requested otherwise.
- Be direct, precise, and critical when evaluating decisions.
- Do not agree with a proposal merely because the user suggested it.

## Before Starting Work

- Identify the current Git branch and HEAD commit.
- Inspect the working tree for staged and unstaged changes.
- Never discard, overwrite, or revert existing user changes.
- Inspect relevant implementation files before proposing changes.
- Identify existing abstractions, dependencies, and conventions.
- Do not assume that the main branch matches the current workspace.
- Distinguish verified facts from assumptions.

## Architecture

- Preserve established module boundaries and responsibilities.
- Prefer existing services, ports, adapters, and utilities.
- Do not introduce unnecessary abstraction layers.
- Do not create new modules when existing modules are sufficient.
- Avoid speculative generalization and overengineering.
- Prefer simple, maintainable solutions.
- Consider the impact of changes on existing functionality.
- Do not change public API contracts without justification.
- Do not introduce fallback, retry, caching, or orchestration
  mechanisms unless explicitly required.

## Planning

Start with the smallest relevant scope.
Expand only when dependencies require it.

For non-trivial changes, include:

- The problem and expected user-visible behavior.
- Relevant existing implementation and affected modules.
- The proposed architecture and rationale.
- Important alternatives and trade-offs.
- Changes to data flow and contracts.
- Compatibility and regression risks.
- Concrete acceptance criteria and verification methods.

Do not begin implementation during planning.

Wait for approval when the task requires an architectural
decision or changes established business behavior.

## Harness

For substantial features, use the approved documents:

- harness/<feature-name>/SPEC.md
- harness/<feature-name>/PLAN.md
- harness/<feature-name>/STATE.md

SPEC defines product requirements and acceptance criteria.

PLAN defines approved architecture and implementation milestones.

STATE records actual progress, verification and recovery context.

The active Goal must identify the relevant feature directory.

Use the global feature-workflow skill to coordinate
autonomous multi-milestone development.

Use the global feature-implementation skill for coding.

After approval of SPEC and PLAN, independently execute
all authorized milestones.

Do not request confirmation after every successful milestone.

Maintain STATE.md during development.

Before resuming, reconcile STATE.md with actual Git state.

Do not create unnecessary harness documents for trivial tasks.

Approval of a plan does not grant permission for destructive
operations, production changes or paid external services.

## Implementation

- Follow existing project conventions.
- Keep changes focused on the requested functionality.
- Avoid unrelated refactoring.
- Do not install dependencies without justification.
- Do not create unnecessary configuration files.
- Do not silently change established business rules.
- Preserve existing behavior outside the requested scope.
- Prefer modifying existing files over creating redundant ones.
- Do not add features beyond the approved scope.

## Testing and Verification

- Prefer relevant existing tests.
- Small targeted regression tests are allowed within
  explicitly authorized implementation scope.
- Do not create unrelated test suites.
- Do not create new testing frameworks or broad test
  infrastructure without explicit approval.
- Respect explicit user restrictions on test creation.
- Never delete, weaken, or bypass tests to obtain a passing result.
- Use the existing project build command when appropriate.
- Do not introduce a separate TypeScript-checking workflow
  when the existing build already performs the required checks.
- Avoid repeatedly running unrelated test suites.
- Report verification results accurately.
- Never claim that something was tested if it was not executed.

## Database and External Systems

- Do not run destructive database operations without approval.
- Do not apply Prisma migrations without approval.
- Do not modify production data or configuration without approval.
- Do not expose secrets, credentials, or environment variables.
- Do not perform paid external API calls without approval.

## Git

- Preserve the current working tree.
- Do not reset or discard user changes.
- Do not amend existing commits unless explicitly requested.
- Do not commit, push, merge, or create pull requests
  unless the task authorizes these actions.
- Before committing, review the changed files.
- Do not include unrelated changes in commits.
- Use authorized feature branches for autonomous development.
- Record implementation checkpoints in STATE.md.
- Never automatically force-push or merge into main.

## Completion Report

After implementation, provide:

1. A concise summary of what changed.
2. The main architectural decisions and their rationale.
3. The changed files and their responsibilities.
4. Verification performed and actual results.
5. Remaining risks, limitations, or unresolved problems.

Do not declare a task complete if its acceptance criteria
have not been satisfied.

## Support Engine — Productization Policy

This repository contains the foundation of an independent,
reusable AI Support Engine.

NextShop is the reference integration, not the target
platform or the boundary of the product.

The Engine must support different commerce backends,
data providers, AI providers and frontend applications.

For work involving Support Agent, Product Consultant,
Order Agent, Review Intelligence, Agentic Memory,
Customer Help, product enrichment, embeddings,
semantic search, or public chat contracts:

1. Apply the project-local `support-engine-productization`
   skill from `.agents/skills/support-engine-productization/`.

2. Follow its `architecture-contract.md`.

3. Include `portability-checklist.md` in feature review
   and productization audit.

4. Keep domain/application logic independent of
   NextShop-specific infrastructure and UI technologies.

5. Identify and document new platform coupling before
   introducing it.

6. Prefer incremental refactoring. Preserve existing
   behavior and validated contracts.

7. Do not automatically extract microservices or build
   integrations for unsupported external platforms.

8. For feature-workflow tasks, perform portability analysis
   during discovery/planning and verify relevant boundaries
   during review.

9. Do not declare a capability product-ready without
   evidence of independent contracts and replaceable
   external adapters.

Existing parallel feature worktrees must not be modified
outside their approved task scope.
