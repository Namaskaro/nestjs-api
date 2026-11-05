---
name: architecture-review
description: >
  Perform an evidence-based architecture review of an
  existing codebase, module, or subsystem. Use when
  asked to analyze architecture, dependencies, module
  boundaries, design decisions, or refactoring risks.
  Do not use for implementing features or modifying code.
---

# Architecture Review

## Purpose

Evaluate the actual architecture of an existing
software system and explain how it works.

This skill is strictly read-only.

## Investigation

1. Identify the requested scope.
2. Inspect the current Git branch and working tree.
3. Locate relevant modules and entry points.
4. Trace important execution paths.
5. Identify dependencies between components.
6. Determine data ownership and responsibility boundaries.
7. Identify existing design patterns.
8. Compare implementation against documented architecture.
9. Identify architectural risks and inconsistencies.

## Analysis Rules

- Base conclusions on actual code.
- Reference concrete files, symbols, and execution paths.
- Never invent components or relationships.
- Separate verified facts from assumptions.
- Consider compatibility with existing consumers.
- Avoid recommending abstractions without a demonstrated need.
- Do not propose broad rewrites when targeted improvements suffice.
- Evaluate alternatives and their trade-offs.

## Findings

For each significant issue, provide:

- The architectural problem.
- Evidence from the codebase.
- Why it matters.
- Affected components.
- Potential consequences.
- Recommended solution.
- Alternative approaches when relevant.

## Output

Write the report in Russian.

Include:

1. Scope of the investigation.
2. Current architecture.
3. Main components and responsibilities.
4. Important execution and data flows.
5. Architectural strengths.
6. Problems and risks.
7. Recommended improvements.
8. Unverified assumptions and limitations.

Use diagrams when they clarify complex relationships.

## Restrictions

Do not modify files.
Do not create tests.
Do not perform refactoring.
Do not modify database schemas.
Do not generate additional project artifacts unless requested.
