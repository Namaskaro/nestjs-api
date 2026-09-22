import { randomUUID } from 'node:crypto';

import type { EvaluationToolCall } from '../contracts/evaluation-observation';

import type { EvaluationJsonValue } from '../contracts/evaluation-scenario';

export interface EvaluationToolCallSink {
  recordToolCall(call: EvaluationToolCall): void;
}

export type EvaluationCapabilityDefinition<T extends object> = {
  method: keyof T & string;

  name: string;

  mapArgs?: (args: readonly unknown[]) => EvaluationJsonValue;

  mapResult?: (result: unknown) => EvaluationJsonValue | null;
};

type EvaluationCapabilityProxyOptions<T extends object> = {
  target: T;

  definitions: readonly EvaluationCapabilityDefinition<T>[];

  getSink: () => EvaluationToolCallSink | null;
};

function toJsonValue(value: unknown): EvaluationJsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  switch (typeof value) {
    case 'string':
      return value;

    case 'number':
      return value;

    case 'boolean':
      return value;
  }

  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      return null;
    }

    return JSON.parse(serialized) as EvaluationJsonValue;
  } catch {
    return String(value);
  }
}

function defaultResultMetadata(value: unknown): EvaluationJsonValue {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
    };
  }

  if (value !== null && typeof value === 'object') {
    return {
      type: 'object',
    };
  }

  return {
    type: value === null ? 'null' : typeof value,
  };
}

export function createEvaluationCapabilityProxy<T extends object>({
  target,
  definitions,
  getSink,
}: EvaluationCapabilityProxyOptions<T>): T {
  const definitionsByMethod = new Map(
    definitions.map((definition) => [definition.method, definition]),
  );

  return new Proxy(target, {
    get(targetObject, property, receiver) {
      const original = Reflect.get(targetObject, property, receiver);

      if (typeof property !== 'string' || typeof original !== 'function') {
        return original;
      }

      const definition = definitionsByMethod.get(property as keyof T & string);

      if (!definition) {
        return original.bind(targetObject);
      }

      return (...args: unknown[]) => {
        const startedAtMs = Date.now();

        const callId = randomUUID();

        const mappedArgs = definition.mapArgs?.(args) ?? toJsonValue(args);

        const recordSuccess = (result: unknown) => {
          const sink = getSink();

          sink?.recordToolCall({
            callId,

            name: definition.name,

            args: mappedArgs,

            resultMetadata:
              definition.mapResult?.(result) ?? defaultResultMetadata(result),

            durationMs: Math.max(0, Date.now() - startedAtMs),

            error: null,
          });
        };

        const recordError = (error: unknown) => {
          const sink = getSink();

          sink?.recordToolCall({
            callId,

            name: definition.name,

            args: mappedArgs,

            resultMetadata: null,

            durationMs: Math.max(0, Date.now() - startedAtMs),

            error: error instanceof Error ? error.message : String(error),
          });
        };

        try {
          const result = Reflect.apply(original, targetObject, args);

          if (result instanceof Promise) {
            return result.then(
              (resolved) => {
                recordSuccess(resolved);

                return resolved;
              },
              (error) => {
                recordError(error);

                throw error;
              },
            );
          }

          recordSuccess(result);

          return result;
        } catch (error) {
          recordError(error);

          throw error;
        }
      };
    },
  });
}
