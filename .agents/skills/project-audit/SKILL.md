---
name: project-audit
description: Audit an existing project, module, directory, or component for actionable defects and risks with code evidence and P0-P3 severity. Use for a findings-oriented assessment of implemented behavior. Exclude implementation and architecture-only mapping or design review.
---

# Project Audit

Follow applicable AGENTS.md instructions. Confirm the requested scope and source of truth, then record the current branch, HEAD, and worktree state. For a pinned revision, inspect that revision and identify any coverage limits.

## Investigate

Trace actual entry points, callers, dependency wiring, permission checks, data ownership, transactions, and failure paths. Investigate correctness and business rules, security and authorization, data integrity, concurrency and state consistency, reliability and error handling, performance, and architecture and maintainability where relevant to the scope.

Check each candidate finding against upstream validation, guards, conditional updates, schema constraints, and other controls that might prevent it. Distinguish a confirmed code defect from a suspected risk that depends on runtime, configuration, data, or an unverified caller. Avoid asserting a production incident from static code alone. Use read-only evidence and execute existing checks only when allowed and relevant. Do not modify project files, create tests, or apply fixes.

## Severity

Use impact and triggering conditions to select severity. Assess confidence separately.

- **P0** — Critical issue that requires immediate action, such as a broadly reachable compromise or irreversible loss of core data.
- **P1** — Serious impact on a key workflow, security boundary, or data integrity under plausible conditions.
- **P2** — Material issue with limited scope, a narrower trigger, or a viable workaround.
- **P3** — Low-impact, actionable defect or maintainability risk with a concrete consequence.

Exclude cosmetic preferences and issues without an actionable consequence. Group occurrences of the same root cause when one fix would address them.

## Report

Write in Russian. Order findings by severity and summarize coverage and verification limits. For every finding include:

- Severity, short title, and status as confirmed defect or suspected risk.
- Exact file and line, symbol, and evidence showing the relevant execution path.
- Triggering conditions, including required roles, state, configuration, or timing.
- Potential impact and affected scope.
- Confidence as high, medium, or low, with a reason and the evidence still needed.
- A focused recommended solution and the invariant it should restore.
