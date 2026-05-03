import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { CatalogService } from './catalog.service';

@Module({
  imports: [ConfigModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
