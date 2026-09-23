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

    const frozenService = frozenCatalog.createServiceProxy(productAgentService);

    this.delegate = new CurrentProductConsultationTarget(
      aiService,
      frozenService,
    );
  }

  runTurn(input: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    return this.delegate.runTurn(input);
  }
}
