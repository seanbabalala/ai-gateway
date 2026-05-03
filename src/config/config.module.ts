import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { CapabilityService } from './capability.service';
import { SecretReferenceResolver } from './secret-reference-resolver.service';

@Global()
@Module({
  providers: [ConfigService, CapabilityService, SecretReferenceResolver],
  exports: [ConfigService, CapabilityService, SecretReferenceResolver],
})
export class ConfigModule {}
