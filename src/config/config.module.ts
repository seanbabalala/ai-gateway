import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { CapabilityService } from './capability.service';
import { SecretReferenceResolverService } from './secret-reference-resolver.service';
import { ProviderCatalogService } from '../catalog/provider-catalog.service';

@Global()
@Module({
  providers: [
    ConfigService,
    CapabilityService,
    SecretReferenceResolverService,
    ProviderCatalogService,
  ],
  exports: [
    ConfigService,
    CapabilityService,
    SecretReferenceResolverService,
    ProviderCatalogService,
  ],
})
export class ConfigModule {}
