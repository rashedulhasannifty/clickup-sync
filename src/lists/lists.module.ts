import { Module } from '@nestjs/common';
import { ListsRepository } from './lists.repository';
import { ListCatalogService } from './list-catalog.service';
import { ClickupModule } from '../clickup/clickup.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [ClickupModule, DatabaseModule],
  providers: [ListsRepository, ListCatalogService],
  exports: [ListsRepository, ListCatalogService],
})
export class ListsModule {}
