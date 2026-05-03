import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { CapabilityService } from './capability.service';
import { ProviderCatalogService } from '../catalog/provider-catalog.service';

@Global()
@Module({
  providers: [ConfigService, CapabilityService, ProviderCatalogService],
  exports: [ConfigService, CapabilityService, ProviderCatalogService],
})
export class ConfigModule {}
