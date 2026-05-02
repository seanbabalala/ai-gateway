import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { ControlPlaneClientService } from './control-plane-client.service';

@Injectable()
export class GatewayRegistrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayRegistrationService.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private configReloadSub?: Subscription;

  constructor(
    private readonly config: ConfigService,
    private readonly client: ControlPlaneClientService,
  ) {}

  onModuleInit(): void {
    this.syncHeartbeat();
    this.configReloadSub = this.config.onReloadSuccess(() => this.syncHeartbeat());
  }

  onModuleDestroy(): void {
    this.configReloadSub?.unsubscribe();
    this.stopHeartbeat();
  }

  getStatus() {
    const cp = this.config.controlPlane;
    return {
      enabled: this.client.enabled,
      url: cp.url || null,
      ...this.client.state,
    };
  }

  private syncHeartbeat(): void {
    if (!this.client.enabled) {
      this.stopHeartbeat();
      return;
    }
    if (this.heartbeatTimer) return;

    void this.client.ensureRegistered();
    this.heartbeatTimer = setInterval(() => {
      void this.client.heartbeat();
    }, 30_000);
    this.heartbeatTimer.unref?.();

    this.logger.log('Connected Gateway registration enabled');
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.logger.log('Connected Gateway registration disabled');
    }
  }
}
