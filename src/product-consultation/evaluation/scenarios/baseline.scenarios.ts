import type { EvaluationScenario } from '../contracts/evaluation-scenario';

/**
 * Baseline scenarios добавляем только тогда,
 * когда для сценария есть согласованные входные данные.
 *
 * Здесь нельзя придумывать:
 * - товары;
 * - характеристики;
 * - состояние диалога;
 * - результаты поиска;
 * - ожидаемые факты.
 *
 * Один и тот же baseline должен использоваться
 * до, во время и после большого refactor-а.
 */
export const BASELINE_SCENARIOS: readonly EvaluationScenario[] = [];
