---
name: feature-workflow
description: Coordinate the full lifecycle of a repository feature from optional discovery through approval, implementation, verification, review, repair, and acceptance. Use for explicitly requested end-to-end feature delivery or resuming a recorded feature workflow. Exclude standalone research, review, and small edits that do not need lifecycle coordination.
---

# Feature Workflow

Follow applicable AGENTS.md instructions and communicate in Russian. Use this skill to coordinate stages. Load the existing skill for a stage when it applies. Work in the current chat by default. Use subagents only if the user asks for them. Add infrastructure only when the approved feature needs it.

## Choose the necessary stages

Identify the requested behavior and scope. Inspect the current worktree root, branch, HEAD, and staged, unstaged, and untracked changes before editing. Separate existing user work from the feature. Investigate the smallest relevant area and expand when dependencies require it.

Use DISCOVERY only when the problem, value, or product approach needs research. Require PLANNING for non-trivial changes, including changes across components or to public contracts, persistent state, security, or established business rules. Reuse a current plan that already covers the scope and acceptance criteria. A straightforward authorized change can use a short specification and start at IMPLEMENTING. Respect analysis-only or planning-only requests even when the next stage would otherwise be available.

Approval is for specific scope, behavior, and design. Record explicit approval already given for that scope and continue independently through the authorized stages. If an architecture decision or change to established behavior still needs approval, present the concrete plan and wait at APPROVAL. Return to PLANNING and APPROVAL when a repair would change the agreed architecture or business behavior.

## Stage contracts

A blocked stage retains its name. Record the blocker and the next action, then finish any independent authorized work. Resume dependent work when the blocker is resolved.

| Stage | Input | Output | Exit criterion | Allowed next stage |
| --- | --- | --- | --- | --- |
| DISCOVERY | Product question or unresolved user need | Evidence, alternatives, recommended scope | The user problem and the decision needed for delivery are clear | PLANNING for non-trivial work. Otherwise APPROVAL if authorization is missing, or IMPLEMENTING if the specification is settled and authorized. |
| PLANNING | Goal, code evidence, constraints, and discovery results if needed | Plan satisfying AGENTS.md, with affected files, rationale and trade-offs, contract and data changes, risks, concrete acceptance criteria, and existing checks | The plan is reviewable and the verification method for each criterion is clear | APPROVAL if a decision or authorization is missing. Otherwise IMPLEMENTING when the scope is already authorized. Stop at the plan for planning-only work. |
| APPROVAL | Concrete plan or scope and the unresolved decision | User decision and a reference to the approved plan, constraints, and permissions | Required approval is explicit and the approved scope matches the implementation about to start | IMPLEMENTING upon approval. PLANNING if the user requests revisions. Remain here while approval is pending. |
| IMPLEMENTING | Authorized specification or approved plan and verified Git baseline | Focused changes through the normal entry points | The planned behavior is present in the scoped diff | TESTING. Return to PLANNING if the approved design must change. |
| TESTING | Current diff and planned verification | Actual command results and acceptance evidence | Applicable required checks pass on the current change and each result is recorded | REVIEWING on success. REPAIRING for actionable failures. Remain here for a blocked check that needs external action. |
| REVIEWING | Checked diff, acceptance criteria, and available Code Review findings | Findings or a scoped review result | The final diff has been inspected and required fixes are resolved | REPAIRING for required fixes. READY_FOR_ACCEPTANCE when the gate below passes. |
| REPAIRING | Verified finding or failed check and its attempt count | Focused fix, updated count, and targeted recheck | The problem is resolved or the attempt limit or an approval gate is reached | TESTING after a fix. REPAIRING for another focused attempt if the targeted recheck fails and budget remains. PLANNING for a design or behavior change. Remain here with a blocker at the limit. |
| READY_FOR_ACCEPTANCE | Reviewed diff, actual check results, and acceptance checklist | Reviewable handoff with changes, evidence, remaining risks, and exact branch and HEAD | Required technical checks and review have passed. Any remaining user-only acceptance decision is explicit. | COMPLETE after acceptance. REPAIRING for feedback within scope or PLANNING for scope changes. |
| COMPLETE | Verified acceptance criteria and the user's acceptance or previously delegated acceptance authority | Final outcome and verification record | Every agreed criterion is satisfied and any required user acceptance is recorded | Terminal for this scope. |

Use [product-discovery](../product-discovery/SKILL.md) in DISCOVERY and [feature-implementation](../feature-implementation/SKILL.md) for IMPLEMENTING and REPAIRING. In REVIEWING use [project-audit](../project-audit/SKILL.md) only for complex or sensitive changes, such as authorization, money, migrations, or concurrent writes. Scope that audit to the affected behavior.

## Verification, review, and repair

- In TESTING run relevant existing checks using the repository's commands. Record the command, exit status, and material output. Mark each check pass, fail, blocked, not run, or not applicable with a reason. Only an actual successful run counts as a passing command. Explain genuinely inapplicable checks. A required failed, blocked, or unrun check prevents readiness. If the original method is unavailable, obtain approval for equivalent verification of the same criterion.
- Create a new test only when the user explicitly requested it and it belongs to the approved scope. Follow AGENTS.md for fixtures, infrastructure, and build verification. Preserve the assertions and intent of existing tests.
- Inspect staged, unstaged, and relevant untracked changes against the baseline. Use an available local Code Review tool for the scoped diff when applicable. In Codex Desktop the user can run `/review` and provide findings. Continue with direct Git diff review when a review tool is unavailable or unnecessary. Verify findings against the current code before repairing. Use read-only review inputs unless separately authorized.
- Count one repair cycle per problem for a focused fix followed by a targeted recheck. Record the attempt when it starts, with a stable issue key based on the cause. At most three cycles per problem across stages and chats. If the third fails, record the evidence, stop attempting that problem, and report the blocker. Unrelated failures do not justify changing the approved design or weakening checks.
- Re-run affected checks and review the resulting diff after repairs. Before READY_FOR_ACCEPTANCE verify that scope, current diff, and check evidence agree, and that no required fix remains open. COMPLETE requires every acceptance criterion, including any user-only acceptance. Prior delegation can satisfy the acceptance decision when the documented evidence meets the agreed criteria.

## Save and resume substantial work

For a large or multi-turn task, copy the [task state template](assets/task-state.md) into a small Markdown file in an existing ignored writable location, such as `.tmp/feature-workflow/<task-id>.md` in this repository. Verify the path with `git check-ignore` before writing. If that location is unavailable, use a writable path agreed with the user. Keep the state outside the feature diff and record its path in the handoff.

Update it at stage transitions, before a repair attempt, after its recheck, and before yielding with an open task. Keep a short current snapshot and evidence pointers. Cite the actual approval message or approved plan. The file records decisions and does not grant permission.

On resume, read the state and applicable instructions, then re-check the actual worktree, branch, HEAD, status, and scoped diff. Compare them with the recorded baseline and latest verified change. Reconcile user edits, missing files, or changed commits before proceeding. Revalidate checks and approvals affected by drift, preserve attempt counts, and resume at the earliest stage whose exit criterion is no longer met. Do not switch branches or discard changes to make the state match.

## Git and release boundaries

Create a local commit only if the user authorized committing and the current branch is the approved feature branch. Review the staged diff and include only approved feature files. Follow AGENTS.md for other Git actions. Obtain separate explicit authorization for push, merge, or deployment. Acceptance of the feature alone does not authorize release.
