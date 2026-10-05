import { z } from 'zod';
import type { CategoryProfile } from '../../core/consultation-core.schema';
import { getCategoryProfile } from '../../core/profiles';
import { assertSearchSpecMatchesCategoryProfile } from '../../core/search/search-spec-profile';
import { assertChangedStructuredLiteralsDoNotRemain } from '../../core/search/search-semantic-intent';
import {
  SearchConstraintSelectorSchema,
  type SearchSpec,
} from '../../core/search/search-spec.schema';
import type { ProductSearchPort } from './product-search.port';

// Search I/O budget per empty result, unrelated to task/action capacity.
const DIAGNOSTIC_SEARCH_BUDGET = 3;

export const ZeroResultRecoverySchema = z.object({
  resultId: z.string().min(1),
  options: z.array(
    z.object({
      clear: SearchConstraintSelectorSchema,
      label: z.string().min(1),
    }),
  ),
  question: z.string().min(1),
});
export type ZeroResultRecovery = z.infer<typeof ZeroResultRecoverySchema>;

function removeLiteral(intent: string, value: unknown): string {
  if (typeof value !== 'string') return intent;
  const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return intent;
  // Remove only an exact, whole value. Unknown synonyms remain soft retrieval
  // preferences; never discard the whole intent (type/purpose) to broaden it.
  return intent
    .replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
      ' ',
    )
    .replace(/\s+/gu, ' ')
    .trim();
}

export function zeroResultCandidates(
  search: SearchSpec,
  profile: CategoryProfile,
  port: Pick<ProductSearchPort, 'validate'>,
) {
  const candidates: Array<{
    search: SearchSpec;
    option: ZeroResultRecovery['options'][number];
  }> = [];
  for (const attributeId of new Set(
    profile.searchRelaxationAttributeIds ?? [],
  )) {
    if (profile.criticalAttributes.includes(attributeId)) continue;
    const attribute = profile.attributes.find(
      (item) => item.id === attributeId,
    );
    if (!attribute) continue;
    for (const [index, constraint] of search.constraints.entries()) {
      if (constraint.attributeId !== attributeId) continue;
      const candidate: SearchSpec = {
        ...search,
        semanticIntent: removeLiteral(search.semanticIntent, constraint.value),
        constraints: search.constraints.filter((_, i) => i !== index),
      };
      if (!candidate.semanticIntent) continue;
      try {
        assertSearchSpecMatchesCategoryProfile(candidate, profile);
        assertChangedStructuredLiteralsDoNotRemain(search, candidate);
        port.validate(candidate);
      } catch {
        continue;
      }
      const operator = { eq: '=', contains: 'содержит', lte: '≤', gte: '≥' }[
        constraint.operator
      ];
      const valueLabel = String(constraint.value);
      const displayValue =
        valueLabel.length > 160 ? `${valueLabel.slice(0, 160)}…` : valueLabel;
      candidates.push({
        search: candidate,
        option: {
          clear: { attributeId, operator: constraint.operator },
          label: `${attribute.label} ${operator} ${displayValue}${
            constraint.unit ? ` ${constraint.unit}` : ''
          }`,
        },
      });
      if (candidates.length === DIAGNOSTIC_SEARCH_BUDGET) return candidates;
    }
  }
  return candidates;
}

/** Read-only probes through the same availability-filtered search boundary. */
export async function recoverZeroResults(input: {
  search: SearchSpec;
  resultId: string;
  port: ProductSearchPort;
}): Promise<ZeroResultRecovery> {
  const candidates = zeroResultCandidates(
    input.search,
    getCategoryProfile(input.search.category),
    input.port,
  );
  const checked = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const products = await input.port.search(candidate.search);
        return products.length > 0 ? candidate.option : null;
      } catch {
        return null;
      }
    }),
  );
  const options = checked.filter(
    (option): option is NonNullable<typeof option> => option !== null,
  );
  const question =
    options.length > 0
      ? `По исходным условиям товаров не нашёл. Поиск нашёл варианты при снятии одного из ограничений: ${options
          .map((option) => `«${option.label}»`)
          .join(
            '; ',
          )}. Какое ограничение можно снять? Остальные условия сохранятся.`
      : 'По исходным условиям товаров не нашёл. Подтверждённых вариантов для изменения условий пока нет. Что можно изменить в запросе?';
  return { resultId: input.resultId, options, question };
}
