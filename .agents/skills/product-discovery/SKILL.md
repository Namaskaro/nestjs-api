---
name: product-discovery
description: Research a product idea or discover useful capabilities missing from the project. Use when the user asks what to build, how current industry solutions work, or which approach is worth pursuing. Deliver evidence and prioritized options. Exclude audits of existing defects and feature implementation.
---

# Product Discovery

Use this skill for a specific idea or for open discovery. For a specific idea, validate the problem and compare ways to solve it. For open discovery, inspect the current product flows and look for unmet needs or missing capabilities. Start with the intended user and the decision the research should support.

Follow applicable AGENTS.md instructions. Establish the repository revision and inspect the relevant entry points, modules, and data contracts before judging fit or claiming a capability is missing. Communicate findings in Russian.

## Research

- Identify the affected users, the problem they face, the current workaround, and the business outcome an improvement could change. Label unsupported demand, adoption, cost, and impact estimates as hypotheses.
- Research current solutions and engineering practices using available external sources. Prefer official product documentation, primary research, source repositories, and credible engineering reports. Cite direct sources with dates or versions where relevant. Distinguish documented behavior from vendor claims and your own inference. State any material research gaps.
- Compare the external evidence with the code. Mark capabilities as implemented, partial, absent in the inspected scope, or unverified. Anchor claims about this repository to files, symbols, and actual execution paths.
- Evaluate credible alternatives on user value, architectural fit, affected contracts and data, implementation effort, operational cost, risks, and limitations. Explain the assumptions behind estimates and which trade-offs change the recommendation.

## Deliverable

Provide a prioritized shortlist with reasons to pursue, defer, or reject each option. For the leading option, describe a minimum viable implementation, the outcome that would validate it, and the main dependencies or unknowns. Separate verified practices from proposals and hypotheses.

Keep discovery read-only for the application. Research and outline options without implementing functionality or making paid external calls without approval.
