import { createHash } from 'node:crypto';

export type EmbeddingProvider = 'yandex' | 'openai' | 'qwen';
export type EmbeddingSpec = {
  provider: EmbeddingProvider;
  queryModel: string;
  documentModel: string;
  dimensions: number;
  // Included in the space hash only for new deployments; legacy hashes stay stable.
  service?: string;
  baseURL?: string;
};
export type EmbeddingOptions = { signal?: AbortSignal };

export class EmbeddingRequestError extends Error {
  public readonly cause?: unknown;
  constructor(
    public readonly category:
      | 'availability'
      | 'configuration'
      | 'invalid-response',
    public readonly provider: EmbeddingProvider,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(
      `Embedding ${provider}: ${category}${status ? ` (HTTP ${status})` : ''}`,
    );
    this.cause = options?.cause;
    this.name = 'EmbeddingRequestError';
  }
}

export function embeddingSpace(spec: EmbeddingSpec): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex');
}

export function embeddingHttpFailure(
  provider: EmbeddingProvider,
  status: number,
  code?: string,
): EmbeddingRequestError {
  const rateLimited =
    /^(rate_limit_exceeded|rate_limit_error|RateLimitExceeded|TooManyRequests|Throttling\..+)$/i.test(
      code ?? '',
    );
  return new EmbeddingRequestError(
    [408, 500, 502, 503, 504].includes(status) ||
    (status === 429 && rateLimited)
      ? 'availability'
      : 'configuration',
    provider,
    status,
  );
}

export function validateEmbedding(
  vector: unknown,
  spec: EmbeddingSpec,
): number[] {
  if (
    !Array.isArray(vector) ||
    vector.length !== spec.dimensions ||
    vector.some(
      (v) =>
        (typeof v !== 'number' && typeof v !== 'string') ||
        String(v).trim() === '' ||
        !Number.isFinite(Number(v)),
    )
  )
    throw new EmbeddingRequestError('invalid-response', spec.provider);
  return vector.map(Number);
}
