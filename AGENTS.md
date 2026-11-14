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
- For PostgreSQL or Qdrant features, follow `infra/integration/README.md` and
  run the relevant functional integration tests against the isolated Shared
  Integration Test Environment. Infrastructure smoke checks alone do not
  verify feature behavior.

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

Переносимость — обязательное архитектурное требование для всех
существующих и будущих модулей Support Engine. При discovery, проектировании,
реализации, рефакторинге, ревью, аудите или подготовке выпуска:

1. Примени локальный skill `.agents/skills/support-engine-productization/SKILL.md`,
   прочитай его `architecture-contract.md` и используй `portability-checklist.md`.
   Правило охватывает Support Agent, маршрутизацию, Product Consultant,
   Order Agent, Review Intelligence, Agentic Memory, User Context, Customer Help,
   LLM, обогащение, embeddings, поиск, persistence, адаптеры, deployment,
   клиентские API и события. Ориентируйся на затронутую границу, а не на имя папки.
2. На discovery и в плане укажи границы, владельцев данных, зависимости и способ
   проверки. В review проверь фактический путь выполнения. Сохраняй поведение
   NextShop и совместимость подтверждённых контрактов. Фиксируй унаследованные
   связи и план постепенного устранения. Новые связи согласовывай заранее.
3. Для `REUSABLE_PRODUCT` фиксируй отдельно `MILESTONE_GATE`, `PORTABILITY_GATE`
   и `RELEASE_GATE` в применимом `STATE.md` или отчёте. Design и integration gates
   не заменяют эти проверки. Для затронутой внешней границы обязателен общий
   контрактный прогон с рабочим и независимым адаптерами. Синтетический второй
   источник подтверждает проверенную архитектурную переносимость в пределах
   прогона. Поддержка реальной интеграции требует доказательств на её API.
4. Называй capability или продукт `production-ready` только после
   `RELEASE_GATE: PASS` для конкретной ревизии, профиля поставки и заявленных
   интеграций. Отдельно указывай непроверенные сценарии и блокеры.
5. Оставляй домен и прикладные сценарии независимыми от NextShop, транспорта
   и конкретной инфраструктуры. Независимость внешних источников не требует
   нескольких СУБД для внутреннего состояния Engine. Не выделяй микросервисы и
   не реализуй интеграции вне согласованного объёма.

Existing parallel feature worktrees must not be modified
outside their approved task scope.
