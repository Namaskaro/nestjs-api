import {
  EvaluationJsonValueSchema,
  type EvaluationJsonValue,
} from '../contracts/evaluation-scenario';

import { z } from 'zod';

export const EvaluationFixtureSchema = z.object({
  /**
   * Стабильный ID набора данных.
   *
   * Например ID конкретного утверждённого
   * baseline dataset-а.
   */
  id: z.string().trim().min(1),

  description: z.string().trim().min(1).nullable().default(null),

  /**
   * Данные fixture.
   *
   * Evaluation Harness не знает,
   * что именно внутри:
   * каталог, product facts,
   * состояние разговора и т.д.
   *
   * Интерпретирует это конкретный Target.
   */
  data: EvaluationJsonValueSchema,
});

export type EvaluationFixture = z.infer<typeof EvaluationFixtureSchema>;

export type EvaluationFixtureData = EvaluationJsonValue;
