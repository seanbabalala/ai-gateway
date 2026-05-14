import { Module } from '@nestjs/common';
import { ProviderClientService } from './provider-client.service';
import { UpstreamConnectionPoolService } from './upstream-connection-pool.service';
import { CredentialPoolService } from './credential-pool.service';

@Module({
  providers: [ProviderClientService, UpstreamConnectionPoolService, CredentialPoolService],
  exports: [ProviderClientService, UpstreamConnectionPoolService, CredentialPoolService],
})
export class ProvidersModule {}
