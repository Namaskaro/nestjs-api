import { Module } from '@nestjs/common';
import { YookassaService } from './yookassa.service';

@Module({
  providers: [YookassaService],
  exports: [YookassaService],
})
export class YookassaModule {}
