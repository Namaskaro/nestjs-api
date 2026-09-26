import type { ProductConsultationLlmContext } from '../context/product-consultation-context';

export type ProductConsultantRoundObservation =
  | {
      kind: 'initial';
    }
  | {
      kind: 'search';

      status: 'succeeded' | 'zero_results' | 'failed' | 'no_change';

      count: number | null;
    }
  | {
      kind: 'show_results';

      status: 'ready' | 'missing';

      count: number;
    }
  | {
      kind: 'details';

      status: 'ready' | 'product_unavailable';
    }
  | {
      kind: 'compare';

      status: 'ready' | 'product_unavailable';
    }
  | {
      kind: 'recommend';

      status: 'context_ready' | 'product_unavailable';
    };

export type ProductConsultantModelInput = {
  context: ProductConsultationLlmContext;

  observation: ProductConsultantRoundObservation;

  /**
   * 1:
   * понять исходную реплику.
   *
   * 2:
   * объяснить deterministic
   * backend observation.
   */
  round: 1 | 2;

  /**
   * Основа для будущего timeout /
   * request cancellation.
   *
   * Сам port пока не навязывает
   * конкретный provider SDK.
   */
  signal?: AbortSignal;
};

/**
 * Единственная LLM-граница
 * нового Product Consultation.
 *
 * Возвращаем unknown намеренно:
 *
 * любой provider structured output
 * является недоверенным входом
 * и должен пройти Zod boundary
 * внутри application loop.
 */
export interface ProductConsultantModelPort {
  decide(input: ProductConsultantModelInput): Promise<unknown>;
}

export const PRODUCT_CONSULTANT_MODEL_PORT = Symbol(
  'PRODUCT_CONSULTANT_MODEL_PORT',
);
