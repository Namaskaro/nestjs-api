import type { EvaluationScenario } from '../contracts/evaluation-scenario';

import { E01_PRODUCT_SELECTION_FLOW } from './e01-product-selection-flow.scenario';

/**
 * Единый baseline Product Consultation.
 *
 * Один и тот же набор сценариев должен использоваться
 * до, во время и после большого refactor-а.
 *
 * Сценарий с fixtureId === null уже фиксирует ожидаемое поведение,
 * но не считается полностью deterministic до подключения
 * frozen fixture.
 */
export const BASELINE_SCENARIOS: readonly EvaluationScenario[] = [
  E01_PRODUCT_SELECTION_FLOW,
];
