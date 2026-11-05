---
name: technical-documentation
description: Create developer onboarding documentation, walkthroughs, and technical references for an existing subsystem. Use when the deliverable should teach a junior developer how implemented behavior works. Exclude defect audits, product discovery, and feature implementation.
---

# Technical Documentation

Write for a junior developer or trainee encountering this project for the first time. Follow applicable AGENTS.md instructions. Write deliverables in Russian unless the user requests another language. Keep code identifiers, file paths, and API names as implemented.

Identify the source revision and the requested scope. Trace the active entry points, module wiring, callers, schemas, persistence, and output consumers before writing. Ground claims in current code and cite file locations and symbols. Use existing documentation to explain confirmed design intent. State observable responsibilities or constraints when the original rationale is unknown. Label illustrative data, unverified runtime behavior, and proposals distinctly.

## Subsystem walkthrough

Keep the introduction short. Explain the business purpose and show two or three use cases supported by the implementation. Identify the actor, trigger, and outcome for each. If the scoped subsystem supports fewer use cases, cover those that exist.

Trace one scenario from a concrete request or event through the main components to the returned result or emitted event. Show where data is validated, transformed, and stored, and which component owns each decision. Use a flow or sequence diagram labeled with actual components and payloads. Define unfamiliar terms when they first matter. Save implementation details for the technical reference.

## File reference

Cover each file that materially affects the flow. Give its path, responsibility, reason for being in the flow, and the components it calls or depends on. Name the functions, schemas, and constants that matter and show how callers use them. Group supporting files by responsibility where that helps the reader find the main path.

## Function walkthroughs

For each significant function, explain its purpose and why the caller needs it in plain language. Explain each parameter's type, meaning, source, and constraints. Walk through processing in execution order, including conditions that change the outcome, defaults, and relevant edge cases. Describe returned values and the next consumer, along with errors and side effects such as state updates, writes, or external calls.

Use the teaching sequence in [Mastra's foreach walkthrough](https://mastra.ai/docs/workflows/control-flow#looping-with-foreach) as a presentation model. Explain the purpose, show the input shape and a concrete call, trace the transformation, show the exact output shape and its next consumer, then explain options that change behavior. For settings such as concurrency, show the verified default and what a different value changes in scheduling, output order, or downstream execution when applicable.

Use short excerpts of actual TypeScript alongside sample inputs, intermediate values, and outputs. For example, when explaining `recentMessagesFromState` in `src/support-agent/graph/workers/product-agent.worker.ts`, show how the current message is excluded and how a message becomes a `{ role, text }` record. Label seven normalized records `m1` through `m7` and show `[m1, m2, m3, m4, m5, m6, m7]` becoming `[m2, m3, m4, m5, m6, m7]` at `result.slice(-6)`. Explain that the operation keeps up to six records in their existing order, then show how the worker passes them as `recentMessages` to `productAgent.invoke()`. Recheck the example against the code at the revision being documented.

## Schemas and state

For every significant field, give its name, type, optionality or nullability, and meaning. Identify the source or writer, actual readers, and when and how the field changes. Explain what a missing value means, including defaults, validation, and any different behavior for omitted, null, or empty values. Use a table for the field reference and a worked example for changes across steps.

### LangGraph execution

When documenting a graph, trace one example through the actual State and nodes. Show the incoming state, fields each node reads, the returned update, and the resulting state. Explain how updates replace or merge values according to the configured reducers and how edges or `Command` choose the next node. Keep state updates, control flow, and side effects distinguishable.

For an interruptible graph, walk through the request that reaches `interrupt`, the payload exposed to the caller, and the checkpoint and thread identity used to resume. Show the incoming resume payload, its validation, how `Command({ resume: ... })` delivers it, and the branch and state changes that follow. Check whether execution reenters the node and which pre-interrupt operations can run again. Use a sequence diagram or a before, paused, and resumed state table to make the lifecycle traceable.

## Review before delivery

Read the walkthrough as a newcomer. Verify that a reader can follow the same example from input to result, identify why each important component is involved, and understand the consequential branches without reconstructing the flow from source files. Recheck example values, code excerpts, field meanings, and cited callers against the implementation.

Keep the overview brief and give important mechanisms enough room. Split long documentation into chapters or linked files at natural boundaries. Keep application code and tests outside the documentation task.
