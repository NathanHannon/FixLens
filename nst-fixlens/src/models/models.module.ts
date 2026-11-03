import { Module } from '@nestjs/common';
import { MetaModelsService } from './meta-models.service.js';
@Module({ providers: [MetaModelsService], exports: [MetaModelsService] })
export class ModelsModule {}
