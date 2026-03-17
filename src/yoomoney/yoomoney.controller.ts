import { Controller } from '@nestjs/common';
import { YookassaService } from 'nestjs-yookassa';

@Controller('yookassa')
export class YoomoneyController {
  constructor(private readonly yookassaService: YookassaService) {}
}
