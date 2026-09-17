// NEW FILE — модуль локального reranker
import { Module } from '@nestjs/common';

import { RerankerService } from './reranker.service';

@Module({
  providers: [RerankerService],

  exports: [RerankerService],
})
export class RerankerModule {}
