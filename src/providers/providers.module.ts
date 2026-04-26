import { Module } from '@nestjs/common';
import { ProviderClientService } from './provider-client.service';

@Module({
  providers: [ProviderClientService],
  exports: [ProviderClientService],
})
export class ProvidersModule {}
