import { ArtifactEvaluator } from './checks/artifact.evaluator';

import { NoErrorsEvaluator } from './checks/no-errors.evaluator';

import { ToolCallCountEvaluator } from './checks/tool-call-count.evaluator';

import { DeterministicEvaluator } from './deterministic-evaluator';

export function createDefaultDeterministicEvaluator(): DeterministicEvaluator {
  return new DeterministicEvaluator([
    new NoErrorsEvaluator(),

    new ToolCallCountEvaluator(),

    new ArtifactEvaluator(),
  ]);
}
