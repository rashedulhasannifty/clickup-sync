import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module';
import { DatabaseModule } from '../database/database.module';
import { DOCUMENT_STORAGE, type DocumentStorage } from './document-storage';
import { DocumentsEnabledGuard } from './documents-enabled.guard';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { DisabledDocumentStorage, S3DocumentStorage } from './s3-document-storage';

@Module({
  // AuditLogInterceptor/AuditLogRepository come from AdminModule (see its exports).
  imports: [DatabaseModule, AdminModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsRepository,
    DocumentsService,
    DocumentsEnabledGuard,
    {
      provide: DOCUMENT_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DocumentStorage => {
        const endpoint = config.get<string>('DOCUMENTS_S3_ENDPOINT') ?? '';
        // env.validation guarantees the five values are all set or all empty.
        if (!endpoint) return new DisabledDocumentStorage();
        return new S3DocumentStorage({
          endpoint,
          region: config.get<string>('DOCUMENTS_S3_REGION') ?? '',
          bucket: config.get<string>('DOCUMENTS_S3_BUCKET') ?? '',
          accessKeyId: config.get<string>('DOCUMENTS_S3_ACCESS_KEY_ID') ?? '',
          secretAccessKey: config.get<string>('DOCUMENTS_S3_SECRET_ACCESS_KEY') ?? '',
          forcePathStyle: config.get<boolean>('DOCUMENTS_S3_FORCE_PATH_STYLE') ?? true,
        });
      },
    },
  ],
  // DocumentsService: the offboarding flow (src/exits) stores generated letters through it.
  exports: [DocumentsService],
})
export class DocumentsModule {}
