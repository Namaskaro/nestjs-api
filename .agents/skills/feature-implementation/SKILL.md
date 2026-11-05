---
name: feature-implementation
description: Implement an approved feature in the existing application from an agreed plan or specification. Use when the user authorizes code changes and the intended behavior is settled. Exclude discovery, planning-only tasks, and unapproved architectural or business decisions.
---

# Feature Implementation

## Establish scope

Read applicable AGENTS.md instructions and the approved plan or specification, including relevant decisions already agreed in the conversation. Confirm the target behavior, acceptance criteria, and approved scope. Record the current branch, HEAD, and staged, unstaged, and untracked changes. Protect existing user work.

Trace the feature's normal entry points, callers, and data flow. Identify affected components, dependencies, public contracts, state ownership, and existing checks. For non-trivial work, reconcile the plan with the actual implementation, including any API or database impact and compatibility risks.

If the code reveals an unresolved architectural decision or a change to established business behavior outside the approved scope, prepare the evidence and options and obtain approval before that change. Proceed with the parts already authorized.

## Implement

- Make the smallest focused change that satisfies the approved behavior through its actual entry points. Reuse established services, ports, adapters, utilities, and conventions.
- Preserve unrelated behavior, existing consumers, and supported data. When relevant, reason through failure, retries, and concurrent state changes. Keep existing business rules unless the approved plan changes them.
- Keep work within existing module boundaries where possible. Add dependencies or infrastructure only when justified and within scope. Follow repository approval rules for migrations, external systems, and Git operations.

## Verify and report

- Use relevant existing checks and the repository's build command when appropriate. Do not create new tests unless explicitly requested. Do not create fixtures or test infrastructure without approval, or weaken existing checks.
- Review the final diff, including new files, against the approved plan and initial worktree. Confirm the normal path and affected edge cases within the allowed verification scope.
- Report in Russian what changed, why, which files own each change, which checks ran and their actual results, and remaining risks or acceptance criteria that could not be verified.
