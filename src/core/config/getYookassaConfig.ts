import { ConfigService } from '@nestjs/config';
import { YookassaModuleOptions } from 'nestjs-yookassa';

export function getYookassaConfig(
  configService: ConfigService,
): YookassaModuleOptions {
  return {
    shopId: configService.get<string>('YOOKASSA_SHOP_ID'),
    apiKey: configService.get<string>('YOOKASSA_SECRET_KEY'),
  };
}
