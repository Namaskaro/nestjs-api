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

Start with the smallest relevant scope. Expand only when dependencies require it.

For non-trivial changes, include:

- The problem and expected user-visible behavior.
- Relevant existing implementation and affected modules, files, and dependencies.
- The proposed architecture and rationale, using only necessary abstractions.
- Important alternatives and trade-offs.
- Changes to data flow and contracts, including database or API changes when applicable.
- Compatibility and regression risks.
- Concrete acceptance criteria and verification using existing checks.

Do not begin implementation during planning. Follow the test creation rule
in Testing and Verification.

Wait for approval when the task requires an architectural
decision or changes established business behavior.

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

- NEVER create new tests unless the user explicitly requests them.
- Do not create test fixtures or test infrastructure without approval.
- Existing tests may be executed when relevant.
- Never delete, weaken, or bypass tests to obtain a passing result.
- Use the existing project build command when build verification
  is appropriate.
- Do not introduce a separate TypeScript-checking workflow
  when the existing build already performs the required checks.
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

## Completion Report

After implementation, provide:

1. A concise summary of what changed.
2. The main architectural decisions and their rationale.
3. The changed files and their responsibilities.
4. Verification performed and actual results.
5. Remaining risks, limitations, or unresolved problems.

Do not declare a task complete if its acceptance criteria
have not been satisfied.
