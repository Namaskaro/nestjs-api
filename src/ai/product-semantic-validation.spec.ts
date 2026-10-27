import { ChatOpenAI } from '@langchain/openai';
import { Logger } from '@nestjs/common';
import { AiService } from './ai.service';
import { ProductsService } from '../modules/products/products.service';

// Real Responses SDK and application indexing entry point; no external services.
describe('Product semantic output validation before indexing', () => {
  const semantic = {
    summary: 'Кроссовки для прогулок',
    targetAudience: [],
    styleAssociations: [],
    useCases: [],
    pricePositioning: 'средний',
    searchTags: [],
  };
  const input = {
    title: 'Кроссовки',
    description: 'Для прогулок',
    brand: 'Test',
    subcategory: 'Обувь',
    color: '',
    details: [],
    price: '1000',
  };
  let ai: AiService;
  let output: unknown;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      LANGSMITH_TRACING: 'false',
      LANGCHAIN_TRACING_V2: 'false',
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    // Exercise the real semantic method and real SDK, without depending on
    // either the pre-A injected clients or the Direct configuration constructor.
    ai = Object.create(AiService.prototype) as AiService;
    jest.spyOn(ai, 'getChatModel').mockReturnValue(
      new ChatOpenAI({
        apiKey: 'offline',
        model: 'gpt-6.1-sol',
        useResponsesApi: true,
        disableStreaming: true,
        maxRetries: 0,
        configuration: {
          fetch: (url, options) => globalThis.fetch(url, options),
        },
      }),
    );
    output = semantic;
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        expect(String(url)).toBe('https://api.openai.com/v1/responses');
        return new Response(
          JSON.stringify({
            id: 'resp_semantic',
            object: 'response',
            created_at: 1,
            status: 'completed',
            model: 'gpt-6.1-sol',
            error: null,
            output: [
              {
                type: 'message',
                id: 'msg_semantic',
                role: 'assistant',
                status: 'completed',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify(output),
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid completed semantic response through jsonSchema', async () => {
    await expect(
      ai.createProductSemanticRepresentation(input),
    ).resolves.toEqual(semantic);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text.format.type).toBe('json_schema');
  });

  it('rejects completed JSON with summary: 42 before search text, embeddings or index writes', async () => {
    output = { ...semantic, summary: 42 };
    const searchText = jest.spyOn(ai, 'buildProductSearchText');
    const embedding = jest
      .spyOn(ai, 'createProductEmbedding')
      .mockResolvedValue([1, 2]);
    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 'product-1' }]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          ...input,
          brand: { id: 'brand-1', name: input.brand },
          subcategory: {
            id: 'subcategory-1',
            name: input.subcategory,
            category: { id: 'category-1', name: 'SHOES' },
          },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const qdrant = { savePoint: jest.fn().mockResolvedValue(undefined) };
    type Dependencies = ConstructorParameters<typeof ProductsService>;
    const products = new ProductsService(
      prisma as unknown as Dependencies[0],
      {} as Dependencies[1],
      {} as Dependencies[2],
      {} as Dependencies[3],
      {} as Dependencies[4],
      {} as Dependencies[5],
      ai,
      qdrant as unknown as Dependencies[7],
    );

    await expect(products.reindexProducts()).rejects.toMatchObject({
      name: 'ZodError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ['summary'], code: 'invalid_type' }),
      ]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prisma.product.findUnique).toHaveBeenCalledTimes(1);
    expect(searchText).not.toHaveBeenCalled();
    expect(embedding).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(qdrant.savePoint).not.toHaveBeenCalled();
  });
});
