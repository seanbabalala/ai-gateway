import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { CatalogService } from './catalog.service';
import { CatalogSyncService } from './catalog-sync';

@Module({
  imports: [ConfigModule],
  providers: [CatalogService, CatalogSyncService],
  exports: [CatalogService, CatalogSyncService],
})
export class CatalogModule {}
