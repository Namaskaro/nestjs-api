import { Controller } from '@nestjs/common';
import { StoreKnowledgeService } from './store-knowledge.service';

@Controller('store-knowledge')
export class StoreKnowledgeController {
  constructor(private readonly storeKnowledgeService: StoreKnowledgeService) {}
}
