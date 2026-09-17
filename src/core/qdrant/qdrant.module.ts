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

        return new QdrantClient({
          url,
        });
      },
    },

    QdrantService,
  ],

  exports: [QdrantService],
})
export class QdrantModule {}
