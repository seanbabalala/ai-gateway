import { Global, Module } from '@nestjs/common';
import { ControlPlaneClientService } from './control-plane-client.service';
import { GatewayRegistrationService } from './gateway-registration.service';
import { PolicySyncService } from './policy-sync.service';
import { TelemetryUploaderService } from './telemetry-uploader.service';

@Global()
@Module({
  providers: [
    ControlPlaneClientService,
    GatewayRegistrationService,
    PolicySyncService,
    TelemetryUploaderService,
  ],
  exports: [
    ControlPlaneClientService,
    GatewayRegistrationService,
    PolicySyncService,
    TelemetryUploaderService,
  ],
})
export class ControlPlaneModule {}
