import { Module } from '@nestjs/common';
import { QdrantService } from './qdrant.service';
import { QdrantController } from './qdrant.controller';
import { QDRANT_CLIENT } from './qdrant.constants';
import { QdrantClient } from '@qdrant/js-client-rest';

@Module({
  controllers: [QdrantController],
  providers: [
    {
      provide: QDRANT_CLIENT,
      useFactory: () => {
        const url = process.env.QDRANT_URL;

        if (!url) {
          throw new Error('QDRANT_URL не определён');
        }

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
