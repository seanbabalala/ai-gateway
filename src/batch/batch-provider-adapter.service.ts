import { BadGatewayException, GatewayTimeoutException, Injectable } from '@nestjs/common';
import type { NodeConfig } from '../config/gateway.config';
import { SecretReferenceResolverService } from '../config/secret-reference-resolver.service';
import {
  FetchTimeoutError,
  fetchWithTimeout,
  isFetchAbortError,
} from '../http/fetch-with-timeout';
import type { BatchProviderResponse } from './batch.types';

type BatchProviderMethod = 'GET' | 'POST';

@Injectable()
export class BatchProviderAdapterService {
  constructor(private readonly secrets: SecretReferenceResolverService) {}

  async create(
    node: NodeConfig,
    body: Record<string, unknown>,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<BatchProviderResponse> {
    return this.fetchProvider({
      node,
      endpoint: node.batch_endpoint || '/v1/batches',
      method: 'POST',
      body,
      requestId,
      signal,
    });
  }

  async retrieve(
    node: NodeConfig,
    providerBatchId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<BatchProviderResponse> {
    return this.fetchProvider({
      node,
      endpoint: node.batch_status_endpoint || '/v1/batches/:id',
      method: 'GET',
      replacements: { id: providerBatchId, batch_id: providerBatchId },
      requestId,
      signal,
    });
  }

  async cancel(
    node: NodeConfig,
    providerBatchId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<BatchProviderResponse> {
    return this.fetchProvider({
      node,
      endpoint: node.batch_cancel_endpoint || '/v1/batches/:id/cancel',
      method: 'POST',
      replacements: { id: providerBatchId, batch_id: providerBatchId },
      requestId,
      signal,
    });
  }

  async downloadOutput(
    node: NodeConfig,
    ids: { batchId: string; fileId: string },
    requestId: string,
    signal?: AbortSignal,
  ): Promise<BatchProviderResponse> {
    return this.fetchProvider({
      node,
      endpoint: node.batch_result_endpoint || '/v1/files/:id/content',
      method: 'GET',
      replacements: {
        id: ids.fileId,
        file_id: ids.fileId,
        output_file_id: ids.fileId,
        batch_id: ids.batchId,
      },
      requestId,
      signal,
      expectBinary: true,
    });
  }

  private async fetchProvider(input: {
    node: NodeConfig;
    endpoint: string;
    method: BatchProviderMethod;
    body?: Record<string, unknown>;
    replacements?: Record<string, string>;
    requestId: string;
    signal?: AbortSignal;
    expectBinary?: boolean;
  }): Promise<BatchProviderResponse> {
    const url = this.buildUrl(input.node, input.endpoint, input.replacements);
    const headers = await this.providerHeaders(input.node, input.requestId);
    const timeoutMs = input.node.timeout_ms ?? 60_000;

    const started = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: input.method,
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: input.signal,
      }, {
        timeoutMs,
        timeoutMessage: 'Batch upstream request timed out.',
      });
      const contentType = response.headers.get('content-type') || (input.expectBinary ? 'application/octet-stream' : 'application/json');
      const body = await this.readBody(response, contentType, input.expectBinary);
      return {
        statusCode: response.status,
        contentType,
        body,
        headers: this.safeHeaders(response.headers),
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (error instanceof FetchTimeoutError || isFetchAbortError(error)) {
        throw new GatewayTimeoutException('Batch upstream request timed out.');
      }
      if (error instanceof GatewayTimeoutException) throw error;
      throw new BadGatewayException('Batch upstream request failed.');
    }
  }

  private async readBody(
    response: Response,
    contentType: string,
    expectBinary?: boolean,
  ): Promise<Record<string, unknown> | Buffer | string> {
    if (expectBinary || !contentType.includes('application/json')) {
      return Buffer.from(await response.arrayBuffer());
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { raw: text };
    }
  }

  private buildUrl(
    node: NodeConfig,
    endpointTemplate: string,
    replacements: Record<string, string> = {},
  ): string {
    let endpoint = endpointTemplate;
    for (const [key, value] of Object.entries(replacements)) {
      const encoded = encodeURIComponent(value);
      endpoint = endpoint
        .replace(new RegExp(`:${key}\\b`, 'g'), encoded)
        .replace(new RegExp(`\\{${key}\\}`, 'g'), encoded);
    }
    if (/^https?:\/\//i.test(endpoint)) return endpoint;
    return `${node.base_url.replace(/\/+$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  }

  private async providerHeaders(node: NodeConfig, requestId: string): Promise<Record<string, string>> {
    const configured = await this.secrets.resolveRecord(node.headers, {
      optional: true,
      location: `nodes.${node.id}.headers`,
    });
    const credential = node.credentials?.find((entry) => entry.enabled !== false);
    const apiKeyRef = node.api_key || credential?.api_key;
    if (!apiKeyRef) {
      throw new Error(`Node "${node.id}" must define api_key or credentials`);
    }
    const apiKey = await this.secrets.resolveString(apiKeyRef, {
      location: node.api_key
        ? `nodes.${node.id}.api_key`
        : `nodes.${node.id}.credentials.${credential?.id || 'default'}.api_key`,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, application/octet-stream',
      'x-siftgate-request-id': requestId,
      ...configured,
    };
    const authType = node.auth_type || (node.protocol === 'messages' ? 'x-api-key' : 'bearer');
    if (authType === 'x-api-key') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] ||= '2023-06-01';
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private safeHeaders(headers: Headers): Record<string, string> {
    const allowed = new Set(['content-type', 'content-disposition', 'content-length']);
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      if (allowed.has(key.toLowerCase())) result[key.toLowerCase()] = value;
    });
    return result;
  }
}
