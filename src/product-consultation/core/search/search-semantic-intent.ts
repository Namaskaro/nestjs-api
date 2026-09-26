type SemanticIntentConstraint = {
  attributeId: string;

  operator: string;

  value?: string | number | boolean;

  unit?: string | null;
};

type SemanticIntentSearch = {
  semanticIntent: string;

  constraints: readonly SemanticIntentConstraint[];
};

function fail(message: string): never {
  throw new Error(`SearchSemanticIntentPolicy: ${message}`);
}

function constraintKey(
  constraint: Pick<SemanticIntentConstraint, 'attributeId' | 'operator'>,
): string {
  return [constraint.attributeId, constraint.operator].join(':');
}

function normalizeSemanticText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/gu, ' ')
    .trim();
}

function semanticIntentContainsLiteralValue(
  semanticIntent: string,

  value: unknown,
): boolean {
  /**
   * Это intentionally narrow safety guard.
   *
   * Он умеет обнаружить только literal
   * string value, которое уже было
   * известно backend как structured value.
   *
   * Здесь намеренно НЕТ попыток понимать:
   *
   * - синонимы;
   * - транслитерацию;
   * - отрицания;
   * - catalog domains;
   * - произвольные natural-language facets.
   *
   * Это не NLP validator.
   */
  if (typeof value !== 'string') {
    return false;
  }

  const normalizedValue = normalizeSemanticText(value);

  /**
   * Очень короткие values:
   *
   * M
   * L
   * XL
   * 42
   *
   * не участвуют в lexical guard,
   * потому что риск false positive
   * слишком велик.
   */
  if (normalizedValue.length < 3) {
    return false;
  }

  return normalizeSemanticText(semanticIntent).includes(normalizedValue);
}

/**
 * Проверяет только один deterministic invariant:
 *
 * если structured constraint был изменён
 * или удалён, его СТАРОЕ literal string value
 * не должно продолжать жить
 * внутри semanticIntent.
 *
 * Например:
 *
 * current:
 *
 *   semanticIntent = "Nike кроссовки"
 *   brand:eq = Nike
 *
 * candidate:
 *
 *   semanticIntent = "Nike кроссовки"
 *   brand:eq = Adidas
 *
 * → stale Nike отклоняется.
 *
 * Но эта функция намеренно НЕ запрещает:
 *
 *   semanticIntent = "Nike кроссовки"
 *   brand:eq = Nike
 *
 * Само дублирование не является
 * semantic contradiction.
 *
 * И она не пытается доказать,
 * что:
 *
 *   semanticIntent = "Adidas кроссовки"
 *   brand:eq = Nike
 *
 * противоречивы.
 *
 * Для такого вывода нужен domain resolver
 * или natural-language interpretation.
 *
 * Hard facet всё равно authoritative
 * только в structured constraints.
 */
export function assertChangedStructuredLiteralsDoNotRemain(
  current: SemanticIntentSearch,

  candidate: SemanticIntentSearch,
): void {
  const currentByKey = new Map<string, SemanticIntentConstraint>();

  const candidateByKey = new Map<string, SemanticIntentConstraint>();

  for (const constraint of current.constraints) {
    currentByKey.set(
      constraintKey(constraint),

      constraint,
    );
  }

  for (const constraint of candidate.constraints) {
    candidateByKey.set(
      constraintKey(constraint),

      constraint,
    );
  }

  for (const [key, previous] of currentByKey) {
    const next = candidateByKey.get(key);

    const removed = next === undefined;

    const changed =
      next !== undefined &&
      (next.value !== previous.value || next.unit !== previous.unit);

    if (!removed && !changed) {
      continue;
    }

    /**
     * Если старого literal value
     * в semanticIntent никогда не было,
     * переписывать semanticIntent
     * из-за structured change не требуется.
     */
    if (
      !semanticIntentContainsLiteralValue(
        current.semanticIntent,

        previous.value,
      )
    ) {
      continue;
    }

    /**
     * Но если structured slot изменился
     * или исчез, а его старое literal value
     * всё ещё находится в candidate text,
     * retrieval может продолжить тянуть
     * старое значение.
     */
    if (
      semanticIntentContainsLiteralValue(
        candidate.semanticIntent,

        previous.value,
      )
    ) {
      fail(
        `semanticIntent still contains stale structured value ` +
          `${String(previous.value)} after changing ${key}.`,
      );
    }
  }
}
