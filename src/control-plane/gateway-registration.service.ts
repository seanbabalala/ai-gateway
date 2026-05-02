import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { ControlPlaneClientService } from './control-plane-client.service';

@Injectable()
export class GatewayRegistrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayRegistrationService.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly client: ControlPlaneClientService,
  ) {}

  onModuleInit(): void {
    if (!this.client.enabled) return;

    void this.client.ensureRegistered();
    this.heartbeatTimer = setInterval(() => {
      void this.client.heartbeat();
    }, 30_000);
    this.heartbeatTimer.unref?.();

    this.logger.log('Connected Gateway registration enabled');
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getStatus() {
    const cp = this.config.controlPlane;
    return {
      enabled: this.client.enabled,
      url: cp.url || null,
      ...this.client.state,
    };
  }
}
