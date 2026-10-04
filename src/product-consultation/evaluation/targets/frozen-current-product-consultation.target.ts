import { CurrentStoreSearchSpecAdapter } from '../../adapters/current-store/current-store-search-spec.adapter';
import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import {
  FrozenCurrentProductCatalog,
  type CurrentProductConsultationFixture,
} from '../fixtures/current-product-consultation.fixture';

import type {
  EvaluationTargetAdapter,
  EvaluationTargetRunInput,
  EvaluationTargetRunResult,
} from './evaluation-target';

import { CurrentProductConsultationTarget } from './current-product-consultation.target';

export class FrozenCurrentProductConsultationTarget
  implements EvaluationTargetAdapter
{
  readonly target = 'product_consultation' as const;

  private readonly delegate: CurrentProductConsultationTarget;

  constructor(
    aiService: AiService,

    productAgentService: ProductAgentService,

    fixture: CurrentProductConsultationFixture,
  ) {
    const frozenCatalog = new FrozenCurrentProductCatalog(fixture);

    const legacyFrozenService =
      frozenCatalog.createServiceProxy(productAgentService);
    const search = new CurrentStoreSearchSpecAdapter(legacyFrozenService);
    const frozenService = new Proxy(legacyFrozenService, {
      get(target, property, receiver) {
        if (property === 'search') return search.search.bind(search);
        if (property === 'validate') return search.validate.bind(search);
        if (property === 'capabilities')
          return search.capabilities.bind(search);
        // Captured fixtures do not contain semantic representations; never fall through to live Qdrant.
        if (property === 'getProductSemanticRepresentations')
          return async () => new Map();
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    this.delegate = new CurrentProductConsultationTarget(
      aiService,
      frozenService,
    );
  }

  runTurn(input: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    return this.delegate.runTurn(input);
  }
}
