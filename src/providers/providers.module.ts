import { Module } from '@nestjs/common';
import { ProviderClientService } from './provider-client.service';
import { UpstreamConnectionPoolService } from './upstream-connection-pool.service';

@Module({
  providers: [ProviderClientService, UpstreamConnectionPoolService],
  exports: [ProviderClientService, UpstreamConnectionPoolService],
})
export class ProvidersModule {}
