import type { EvaluationResult } from '../contracts/evaluation-result';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatEvaluationResult(result: EvaluationResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(`========== ${result.scenarioId} ==========`);

  lines.push(`RESULT: ${result.status.toUpperCase()}`);

  lines.push('');

  for (const turn of result.observation.turns) {
    lines.push(`----- ${turn.input.id} -----`);

    if (turn.input.kind === 'message') {
      lines.push(`USER: ${turn.input.message}`);
    } else {
      lines.push(`RESUME: ${json(turn.input.value)}`);
    }

    lines.push(`OUTCOME: ${turn.outcome}`);

    if (turn.finalText) {
      lines.push(`ASSISTANT: ${turn.finalText}`);
    }

    if (turn.toolCalls.length) {
      lines.push('CAPABILITIES:');

      for (const call of turn.toolCalls) {
        lines.push(`  - ${call.name}`);

        lines.push(`    args=${json(call.args)}`);

        if (call.resultMetadata !== null) {
          lines.push(`    result=${json(call.resultMetadata)}`);
        }

        if (call.error) {
          lines.push(`    ERROR=${call.error}`);
        }
      }
    } else {
      lines.push('CAPABILITIES: none');
    }

    if (turn.artifacts.length) {
      lines.push(
        `ARTIFACTS: ${turn.artifacts
          .map((artifact) => artifact.kind)
          .join(', ')}`,
      );
    } else {
      lines.push('ARTIFACTS: none');
    }

    if (turn.resultMetadata) {
      lines.push(`METADATA: ${json(turn.resultMetadata)}`);
    }

    if (turn.errors.length) {
      lines.push('ERRORS:');

      for (const error of turn.errors) {
        lines.push(`  - ${error.source}: ${error.message}`);
      }
    }

    lines.push('');
  }

  lines.push('========== CHECKS ==========');

  for (const check of result.checks) {
    const icon =
      check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';

    lines.push(`${icon} ${check.id}`);

    if (check.status !== 'pass') {
      lines.push(`   ${check.message}`);

      if (check.details !== null) {
        lines.push(`   ${json(check.details)}`);
      }
    }
  }

  lines.push('');

  lines.push('========== EXECUTION ==========');

  lines.push(`LLM calls: ${result.execution.llmCalls.total}`);

  lines.push(`Capability calls: ${result.execution.toolCalls.total}`);

  lines.push(`Latency: ${result.execution.latencyMs} ms`);

  lines.push(`Errors: ${result.execution.errorCount}`);

  lines.push(`Fallbacks: ${result.execution.fallbackCount}`);

  const tokens = result.execution.tokens;

  lines.push(
    `Tokens: ${tokens.totalTokens ?? 'unknown'}${
      tokens.usageMissing ? ' (usage incomplete)' : ''
    }`,
  );

  lines.push('');
  lines.push('==============================');

  return lines.join('\n');
}
