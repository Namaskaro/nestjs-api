import { Module } from '@nestjs/common';

import { QdrantService } from './qdrant.service';
import { QDRANT_CLIENT } from './qdrant.constants';

@Module({
  providers: [
    {
      provide: QDRANT_CLIENT,
      useFactory: async () => {
        const url = process.env.QDRANT_URL;

        if (!url) {
          throw new Error('QDRANT_URL не определён');
        }

        const { QdrantClient } = await import('@qdrant/js-client-rest');

        const timeout = Number(process.env.QDRANT_REQUEST_TIMEOUT_MS ?? 60000);
        if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('QDRANT_REQUEST_TIMEOUT_MS must be a positive integer <= 2147483647');
        return new QdrantClient({ url, timeout });
      },
    },

    QdrantService,
  ],

  exports: [QdrantService],
})
export class QdrantModule {}
