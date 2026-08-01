import { Controller } from '@nestjs/common';
import { QdrantService } from './qdrant.service';

@Controller('qdrant')
export class QdrantController {
  constructor(private readonly qdrantService: QdrantService) {}
}
