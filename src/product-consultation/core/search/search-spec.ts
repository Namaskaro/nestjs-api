import {
  SearchSpecPatchSchema,
  SearchSpecSchema,
  type SearchConstraint,
  type SearchConstraintSelector,
  type SearchSpec,
  type SearchSpecPatch,
} from './search-spec.schema';

function constraintKey(
  constraint: SearchConstraint | SearchConstraintSelector,
): string {
  return [constraint.attributeId, constraint.operator].join(':');
}

/**
 * Создаёт новый SearchSpec.
 *
 * Никакой mutation входного state.
 */
export function createSearchSpec(
  input: Omit<SearchSpec, 'version'>,
): SearchSpec {
  return SearchSpecSchema.parse({
    version: 1,

    ...input,
  });
}

/**
 * Deterministic refinement SearchSpec.
 *
 * Главное правило:
 *
 * patch меняет ТОЛЬКО то,
 * что явно присутствует в patch.
 *
 * Остальные constraints сохраняются.
 */
export function applySearchSpecPatch(
  currentRaw: SearchSpec,
  patchRaw: SearchSpecPatch,
): SearchSpec {
  const current = SearchSpecSchema.parse(currentRaw);

  const patch = SearchSpecPatchSchema.parse(patchRaw);

  const constraints = new Map<string, SearchConstraint>();

  for (const constraint of current.constraints) {
    constraints.set(
      constraintKey(constraint),

      constraint,
    );
  }

  /**
   * Сначала explicit clear.
   *
   * Например:
   *
   * "цвет не важен"
   *
   * удаляет только color:eq.
   */
  for (const selector of patch.clear) {
    constraints.delete(constraintKey(selector));
  }

  /**
   * Затем explicit set/replace.
   *
   * Nike → Adidas:
   *
   * brand:eq заменится,
   * gender/color/etc останутся.
   */
  for (const constraint of patch.set) {
    constraints.set(
      constraintKey(constraint),

      constraint,
    );
  }

  return SearchSpecSchema.parse({
    version: 1,

    semanticIntent: patch.semanticIntent ?? current.semanticIntent,

    category: patch.category !== undefined ? patch.category : current.category,

    constraints: [...constraints.values()],
  });
}

export function findSearchConstraint(
  specRaw: SearchSpec,
  selector: SearchConstraintSelector,
): SearchConstraint | null {
  const spec = SearchSpecSchema.parse(specRaw);

  const key = constraintKey(selector);

  return (
    spec.constraints.find((constraint) => constraintKey(constraint) === key) ??
    null
  );
}
