import { Inject, Injectable } from '@nestjs/common';
import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';

import { QDRANT_CLIENT } from './qdrant.constants';

@Injectable()
export class QdrantService {
  constructor(
    @Inject(QDRANT_CLIENT)
    private readonly client: QdrantClient,
  ) {}

  async savePoint(
    collectionName: string,
    point: Schemas['PointStruct'],
  ): Promise<void> {
    await this.client.upsert(collectionName, {
      wait: true,
      points: [point],
    });
  }
}
