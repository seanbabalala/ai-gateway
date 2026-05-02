import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ControlPlaneClientService } from './control-plane-client.service';
import type { PolicyBundle } from './types';

@Injectable()
export class PolicySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PolicySyncService.name);
  private policyTimer: NodeJS.Timeout | null = null;
  private latestPolicy: PolicyBundle | null = null;

  constructor(private readonly client: ControlPlaneClientService) {}

  onModuleInit(): void {
    if (!this.client.enabled) return;
    void this.refresh();
    this.policyTimer = setInterval(() => {
      void this.refresh();
    }, 60_000);
    this.policyTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.policyTimer) {
      clearInterval(this.policyTimer);
      this.policyTimer = null;
    }
  }

  get current(): PolicyBundle | null {
    return this.latestPolicy;
  }

  async refresh(): Promise<PolicyBundle | null> {
    const policy = await this.client.fetchLatestPolicy();
    if (!policy) return this.latestPolicy;

    if (!this.latestPolicy || this.latestPolicy.version !== policy.version) {
      this.logger.log(`Pulled control-plane policy bundle version ${policy.version}`);
    }
    this.latestPolicy = policy;
    return policy;
  }
}
