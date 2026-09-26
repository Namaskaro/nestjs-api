import { ArtifactEvaluator } from './checks/artifact.evaluator';

import { JsonValueEvaluator } from './checks/json-value.evaluator';

import { LlmCallBudgetEvaluator } from './checks/llm-call-budget.evaluator';

import { NoErrorsEvaluator } from './checks/no-errors.evaluator';

import { ToolCallCountEvaluator } from './checks/tool-call-count.evaluator';

import { DeterministicEvaluator } from './deterministic-evaluator';

export function createDefaultDeterministicEvaluator(): DeterministicEvaluator {
  return new DeterministicEvaluator([
    new NoErrorsEvaluator(),

    new ToolCallCountEvaluator(),

    new LlmCallBudgetEvaluator(),

    new ArtifactEvaluator(),

    new JsonValueEvaluator(),
  ]);
}
