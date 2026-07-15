import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { SecretReferenceResolverService } from '../config/secret-reference-resolver.service';
import { fetchWithTimeout } from '../http/fetch-with-timeout';
import type {
  ControlPlaneRegistrationResponse,
  ControlPlaneTelemetryEvent,
  PolicyBundle,
} from './types';

@Injectable()
export class ControlPlaneClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ControlPlaneClientService.name);
  private workspaceId: string | null = null;
  private gatewayId: string | null = null;
  private accessToken: string | null = null;
  private registerInFlight: Promise<boolean> | null = null;
  private configReloadSub?: Subscription;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    private readonly secretResolver?: SecretReferenceResolverService,
  ) {}

  onModuleInit(): void {
    this.configReloadSub = this.config.onReloadSuccess(() => {
      this.resetSession();
    });
  }

  onModuleDestroy(): void {
    this.configReloadSub?.unsubscribe();
  }

  get enabled(): boolean {
    const cp = this.config.controlPlane;
    return Boolean(cp.enabled && cp.url);
  }

  get state(): {
    workspaceId: string | null;
    gatewayId: string;
    registered: boolean;
  } {
    const configuredGatewayId = this.config.controlPlane.gateway_id || 'default';
    return {
      workspaceId: this.workspaceId,
      gatewayId: this.gatewayId || configuredGatewayId,
      registered: Boolean(this.accessToken),
    };
  }

  resetSession(): void {
    this.workspaceId = null;
    this.gatewayId = null;
    this.accessToken = null;
    this.registerInFlight = null;
  }

  async ensureRegistered(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.accessToken) return true;
    if (!this.registerInFlight) {
      this.registerInFlight = this.register().finally(() => {
        this.registerInFlight = null;
      });
    }
    return this.registerInFlight;
  }

  async register(): Promise<boolean> {
    const cp = this.config.controlPlane;
    if (!this.enabled) return false;
    if (!cp.registration_token) {
      this.logger.warn('control_plane.enabled=true but registration_token is not configured');
      return false;
    }

    try {
      const registrationToken = this.secretResolver
        ? await this.secretResolver.resolveString(cp.registration_token, {
            location: 'control_plane.registration_token',
          })
        : cp.registration_token;
      const body = {
        gateway_id: cp.gateway_id || 'default',
        version: process.env.npm_package_version || '0.1.0',
        capabilities: {
          protocols: ['chat_completions', 'responses', 'messages', 'gemini'],
          privacy: {
            prompt_upload_default: false,
            response_upload_default: false,
          },
        },
      };
      const response = await this.request<ControlPlaneRegistrationResponse>(
        'POST',
        '/api/control/register',
        body,
        registrationToken,
      );
      this.workspaceId = response.workspace_id || null;
      this.gatewayId = response.gateway_id || cp.gateway_id || 'default';
      this.accessToken = response.access_token || null;

      if (!this.accessToken) {
        this.logger.warn('Control plane registration response did not include an access token');
        return false;
      }

      this.logger.log(
        `Connected gateway registered: workspace=${this.workspaceId || 'unknown'} gateway=${this.gatewayId}`,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Control plane registration failed: ${(err as Error).message}`);
      return false;
    }
  }

  async heartbeat(): Promise<boolean> {
    if (!(await this.ensureRegistered())) return false;
    try {
      await this.request(
        'POST',
        '/api/control/heartbeat',
        {
          workspace_id: this.workspaceId,
          gateway_id: this.gatewayId,
          status: 'online',
          timestamp: new Date().toISOString(),
        },
        this.accessToken || undefined,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Control plane heartbeat failed: ${(err as Error).message}`);
      return false;
    }
  }

  async uploadTelemetry(events: ControlPlaneTelemetryEvent[]): Promise<boolean> {
    if (!events.length) return true;
    if (!(await this.ensureRegistered())) return false;
    try {
      await this.request(
        'POST',
        '/api/control/telemetry/batch',
        {
          workspace_id: this.workspaceId,
          gateway_id: this.gatewayId,
          events,
        },
        this.accessToken || undefined,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Control plane telemetry upload failed: ${(err as Error).message}`);
      return false;
    }
  }

  async fetchLatestPolicy(): Promise<PolicyBundle | null> {
    if (!(await this.ensureRegistered())) return null;
    try {
      const query = this.gatewayId
        ? `?gateway_id=${encodeURIComponent(this.gatewayId)}`
        : '';
      return await this.request<PolicyBundle>(
        'GET',
        `/api/control/policy/latest${query}`,
        undefined,
        this.accessToken || undefined,
      );
    } catch (err) {
      this.logger.warn(`Control plane policy pull failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const cp = this.config.controlPlane;
    const base = cp.url.replace(/\/+$/, '');
    const url = `${base}${path}`;

    const response = await fetchWithTimeout(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, {
      timeoutMs: 10_000,
      timeoutMessage: 'Control plane request timed out after 10000ms.',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }

    if (response.status === 204) {
      return {} as T;
    }
    return (await response.json()) as T;
  }
}
