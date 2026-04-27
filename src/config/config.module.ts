import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { CapabilityService } from './capability.service';

@Global()
@Module({
  providers: [ConfigService, CapabilityService],
  exports: [ConfigService, CapabilityService],
})
export class ConfigModule {}
