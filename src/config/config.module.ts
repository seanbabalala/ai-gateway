import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { CapabilityService } from './capability.service';
import { ModelCatalogService } from './model-catalog.service';

@Global()
@Module({
  providers: [ConfigService, ModelCatalogService, CapabilityService],
  exports: [ConfigService, ModelCatalogService, CapabilityService],
})
export class ConfigModule {}
