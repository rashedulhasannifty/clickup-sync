import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ClickupClient } from './clickup.client';
import { ClickupNormalizer } from './clickup-normalizer';
import { CustomFieldExtractor } from './custom-field-extractor';

@Module({ imports: [HttpModule], providers: [ClickupClient, ClickupNormalizer, CustomFieldExtractor], exports: [ClickupClient, ClickupNormalizer, CustomFieldExtractor] })
export class ClickupModule {}
