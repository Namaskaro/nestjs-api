import { stdin as input, stdout as output } from 'node:process';

import { createInterface } from 'node:readline/promises';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../core/app.module';

import {
  PRODUCT_CONSULTANT_MODEL_PORT,
  type ProductConsultantModelInput,
  type ProductConsultantModelPort,
} from '../application/consultant/product-consultant-model.port';

import { ProductConsultantLoop } from '../application/consultant/product-consultant-loop';

import {
  PRODUCT_DETAILS_PORT,
  type ProductDetailsPort,
} from '../application/catalog/product-details.port';

import {
  PRODUCT_SEARCH_PORT,
  type ProductSearchPort,
} from '../application/search/product-search.port';

import type { SearchSpec } from '../core/search/search-spec.schema';

import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '../application/runtime/consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from '../application/runtime/consultation-application-store.port';

import {
  ConsultationWriteOwner,
  type ExecuteConsultationTurnInput,
  type ExecuteConsultationTurnResult,
} from '../application/runtime/consultation-write-owner';

import type { ProductConsultationContextMessage } from '../application/context/product-consultation-context';

class DebugConsultationStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord | null = null;

  public async load(
    _conversationId: string,
  ): Promise<ConsultationApplicationRecord | null> {
    return this.record === null
      ? null
      : ConsultationApplicationRecordSchema.parse(structuredClone(this.record));
  }

  public async saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void> {
    const actualRevision = this.record?.revision ?? 0;

    if (actualRevision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,

        input.expectedRevision,

        this.record?.revision ?? null,
      );
    }

    this.record = ConsultationApplicationRecordSchema.parse(
      structuredClone(input.record),
    );
  }
}

function printError(
  title: string,

  error: unknown,
): void {
  console.error('');
  console.error(`================ ${title} ================`);

  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`);

    if (error.stack) {
      console.error('');
      console.error(error.stack);
    }

    const cause = (
      error as Error & {
        cause?: unknown;
      }
    ).cause;

    if (cause !== undefined) {
      console.error('');
      console.error('CAUSE:');

      console.dir(cause, {
        depth: 20,
      });
    }
  } else {
    console.dir(error, {
      depth: 20,
    });
  }

  console.error('=============================================');
  console.error('');
}

/**
 * Показывает нам настоящий JSON,
 * который вернула LLM.
 */
class DebugLoggingModel implements ProductConsultantModelPort {
  constructor(private readonly inner: ProductConsultantModelPort) {}

  public async decide(input: ProductConsultantModelInput): Promise<unknown> {
    console.log('');
    console.log(
      `================ MODEL ROUND ${input.round} INPUT ================`,
    );

    console.dir(
      {
        observation: input.observation,

        currentMessage: input.context.currentMessage,

        task: input.context.task,

        shownProducts: input.context.results.shownProducts,

        productFacts: input.context.productFacts,
      },
      {
        depth: 20,
      },
    );

    console.log('=====================================================');

    try {
      const result = await this.inner.decide(input);

      console.log('');
      console.log(
        `================ MODEL ROUND ${input.round} DECISION ================`,
      );

      console.dir(result, {
        depth: 30,
      });

      console.log('========================================================');
      console.log('');

      return result;
    } catch (error) {
      printError(
        'MODEL ERROR',

        error,
      );

      throw error;
    }
  }
}

/**
 * Показываем SearchSpec,
 * который реально дошёл
 * до current-store boundary.
 */
function createDebugSearchPort(inner: ProductSearchPort): ProductSearchPort {
  return {
    capabilities: inner.capabilities ? () => inner.capabilities!() : undefined,

    validate(search: SearchSpec): void {
      console.log('');
      console.log('================ SEARCH VALIDATE ================');

      console.dir(search, {
        depth: 30,
      });

      console.log('=================================================');

      try {
        inner.validate(search);

        console.log('SEARCH VALIDATE: OK');
        console.log('');
      } catch (error) {
        printError(
          'SEARCH VALIDATION ERROR',

          error,
        );

        throw error;
      }
    },

    async search(search: SearchSpec) {
      console.log('');
      console.log('================ SEARCH EXECUTE ================');

      console.dir(search, {
        depth: 30,
      });

      console.log('================================================');

      try {
        const products = await inner.search(search);

        console.log(`SEARCH RESULT COUNT: ${products.length}`);

        console.dir(products, {
          depth: 20,
        });

        console.log('');

        return products;
      } catch (error) {
        printError(
          'SEARCH EXECUTION ERROR',

          error,
        );

        throw error;
      }
    },
  };
}

/**
 * Loop намеренно преобразует
 * application ошибки в capability_error.
 *
 * Для local debug показываем
 * настоящую причину ДО этого преобразования.
 */
class DebugConsultationWriteOwner extends ConsultationWriteOwner {
  public override async execute(
    input: ExecuteConsultationTurnInput,
  ): Promise<ExecuteConsultationTurnResult> {
    console.log('');
    console.log('================ WRITE OWNER INPUT ================');

    console.dir(
      {
        expectedRevision: input.expectedRevision,

        requestId: input.requestId,

        expectedResultId: input.expectedResultId,

        proposal: input.proposal,
      },
      {
        depth: 30,
      },
    );

    console.log('===================================================');

    try {
      const result = await super.execute(input);

      console.log('');
      console.log('================ WRITE OWNER RESULT ================');

      console.dir(
        {
          status: result.status,

          revision: result.record.revision,

          generation: result.record.generation,

          search: result.record.state?.search ?? null,

          activeResultId: result.record.results.active?.resultId ?? null,
        },
        {
          depth: 20,
        },
      );

      console.log('====================================================');
      console.log('');

      return result;
    } catch (error) {
      printError(
        'WRITE OWNER ERROR',

        error,
      );

      throw error;
    }
  }
}

function createDebugProductDetailsPort(
  inner: ProductDetailsPort,
): ProductDetailsPort {
  return {
    async getProductDetails(productIds: readonly string[]) {
      console.log('');
      console.log('================ PRODUCT DETAILS ================');

      console.dir(
        {
          productIds,
        },
        {
          depth: 10,
        },
      );

      try {
        const result = await inner.getProductDetails(productIds);

        console.log(`DETAILS RESULT COUNT: ${result.length}`);

        console.log('=================================================');
        console.log('');

        return result;
      } catch (error) {
        printError(
          'PRODUCT DETAILS ERROR',

          error,
        );

        throw error;
      }
    },
  };
}

function printArtifacts(
  artifacts: Awaited<ReturnType<ProductConsultantLoop['run']>>['artifacts'],
): void {
  if (artifacts.length === 0) {
    return;
  }

  console.log('\nArtifacts:');

  for (const artifact of artifacts) {
    switch (artifact.kind) {
      case 'search_results': {
        console.log(
          `  search_results: ${artifact.snapshot.products.length} products`,
        );

        artifact.snapshot.products.forEach(
          (
            product,

            index,
          ) => {
            console.log(
              `    ${index + 1}. ${product.title} — ${product.price}`,
            );
          },
        );

        break;
      }

      case 'product_details': {
        console.log(`  product_details: ${artifact.product.title}`);

        break;
      }

      case 'product_comparison': {
        console.log(
          `  product_comparison: ${artifact.comparison.productIds.length} products`,
        );

        break;
      }
    }
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule,

    {
      logger: ['error', 'warn'],
    },
  );

  const rawSearchPort = app.get<ProductSearchPort>(PRODUCT_SEARCH_PORT);

  const rawProductDetails = app.get<ProductDetailsPort>(PRODUCT_DETAILS_PORT);

  const rawModel = app.get<ProductConsultantModelPort>(
    PRODUCT_CONSULTANT_MODEL_PORT,
  );

  const searchPort = createDebugSearchPort(rawSearchPort);

  const productDetails = createDebugProductDetailsPort(rawProductDetails);

  const model = new DebugLoggingModel(rawModel);

  const store = new DebugConsultationStore();

  const writeOwner = new DebugConsultationWriteOwner(
    store,

    searchPort,
  );

  const loop = new ProductConsultantLoop(
    store,

    writeOwner,

    productDetails,

    model,

    {
      modelTimeoutMs: 30_000,

      searchCapabilities: rawSearchPort.capabilities?.() ?? null,

      onDiagnostic: (diagnostic) => {
        console.warn(
          '[diagnostic]',

          diagnostic,
        );
      },
    },
  );

  const readline = createInterface({
    input,

    output,
  });

  const recentMessages: ProductConsultationContextMessage[] = [];

  const conversationId = 'product-consultant-live-debug';

  let turn = 0;

  console.log('');
  console.log('Product Consultant LIVE debug');

  console.log('Напиши сообщение как обычный пользователь.');

  console.log('Для выхода: exit');

  console.log('');

  try {
    while (true) {
      const message = (await readline.question('USER > ')).trim();

      if (!message) {
        continue;
      }

      if (message.toLowerCase() === 'exit') {
        break;
      }

      turn += 1;

      const startedAt = Date.now();

      const result = await loop.run({
        conversationId,

        requestId: `debug-${turn}`,

        currentMessage: message,

        recentMessages,
      });

      const durationMs = Date.now() - startedAt;

      console.log('');
      console.log(`ASSISTANT > ${result.text || '[no text]'}`);

      console.log('');

      console.log(
        [
          `outcome=${result.outcome}`,

          `modelCalls=${result.modelCalls}`,

          `capabilityRounds=${result.capabilityRounds}`,

          `revision=${result.record.revision}`,

          `durationMs=${durationMs}`,
        ].join(' | '),
      );

      printArtifacts(result.artifacts);

      recentMessages.push({
        role: 'user',

        text: message,
      });

      if (result.text) {
        recentMessages.push({
          role: 'assistant',

          text: result.text,
        });
      }

      if (recentMessages.length > 20) {
        recentMessages.splice(
          0,

          recentMessages.length - 20,
        );
      }

      console.log('');
    }
  } finally {
    readline.close();

    await app.close();
  }
}

bootstrap().catch((error) => {
  printError(
    'DEBUG BOOTSTRAP ERROR',

    error,
  );

  process.exitCode = 1;
});
