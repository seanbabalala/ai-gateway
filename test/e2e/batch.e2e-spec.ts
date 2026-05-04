import { createHash } from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createE2EHarness, E2EHarness, API_KEY } from './setup';
import { GatewayApiKey } from '../../src/database/entities/gateway-api-key.entity';
import { BatchJob } from '../../src/database/entities/batch-job.entity';
import { CallLog } from '../../src/database/entities/call-log.entity';

describe('Batch API proxy (e2e)', () => {
  let harness: E2EHarness;
  let batchRepo: Repository<BatchJob>;
  let keyRepo: Repository<GatewayApiKey>;
  let callLogRepo: Repository<CallLog>;

  beforeAll(async () => {
    harness = await createE2EHarness();
    batchRepo = harness.app.get(getRepositoryToken(BatchJob));
    keyRepo = harness.app.get(getRepositoryToken(GatewayApiKey));
    callLogRepo = harness.app.get(getRepositoryToken(CallLog));
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  beforeEach(async () => {
    harness.fetchMock.reset();
    await batchRepo.clear();
    await callLogRepo.clear();
  });

  it('creates a provider batch and stores metadata only', async () => {
    const res = await harness.agent
      .post('/v1/batches')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('x-session-id', 'batch-session-1')
      .send({
        input_file_id: 'file-batch-input',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        model: 'gpt-4o-mini',
        metadata: {
          purpose: 'nightly eval',
          prompt: 'this value must not be stored',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('batch-e2e-1');
    expect(harness.fetchMock.calls[0].url).toBe('http://mock-upstream.test/v1/batches');
    expect(harness.fetchMock.calls[0].headers.Authorization).toBe('Bearer mock-openai-key');

    const jobs = await batchRepo.find();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        provider_batch_id: 'batch-e2e-1',
        input_file_id: 'file-batch-input',
        output_file_id: 'file-batch-output',
        status: 'in_progress',
        node_id: 'mock-openai',
        model: 'gpt-4o-mini',
      }),
    );
    expect(jobs[0].metadata_keys_json).toBe(JSON.stringify(['purpose', 'prompt']));
    expect(JSON.stringify(jobs[0])).not.toContain('nightly eval');
    expect(JSON.stringify(jobs[0])).not.toContain('this value must not be stored');

    const logs = await callLogRepo.find();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_format: 'batch',
          node_id: 'mock-openai',
          model: 'gpt-4o-mini',
          session_id: 'batch-session-1',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
        }),
      ]),
    );
  });

  it('retrieves, cancels, downloads output, and exposes Dashboard metadata', async () => {
    const create = await harness.agent
      .post('/v1/batches')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({
        input_file_id: 'file-batch-input',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        model: 'gpt-4o-mini',
      });

    const batchId = create.body.id;
    const status = await harness.agent
      .get(`/v1/batches/${batchId}`)
      .set('Authorization', `Bearer ${API_KEY}`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('completed');

    const output = await harness.agent
      .get(`/v1/batches/${batchId}/output`)
      .set('Authorization', `Bearer ${API_KEY}`);
    expect(output.status).toBe(200);
    expect(output.text).toContain('"custom_id":"one"');

    const cancel = await harness.agent
      .post(`/v1/batches/${batchId}/cancel`)
      .set('Authorization', `Bearer ${API_KEY}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');

    const dashboard = await harness.agent.get('/api/dashboard/batches');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.metadata_only).toBe(true);
    expect(dashboard.body.items[0]).toEqual(
      expect.objectContaining({
        provider_batch_id: 'batch-e2e-1',
        input_file_id: 'file-batch-input',
        output_file_id: 'file-batch-output',
        node_id: 'mock-openai',
      }),
    );
    expect(JSON.stringify(dashboard.body)).not.toContain('mock-openai-key');
    expect(JSON.stringify(dashboard.body)).not.toContain('response":{"status_code"');
  });

  it('enforces API key endpoint restrictions for batch', async () => {
    const key = 'e2e-batch-blocked-key';
    await keyRepo.save(
      keyRepo.create({
        name: 'batch-blocked',
        key_hash: createHash('sha256').update(key).digest('hex'),
        key_prefix: 'e2e-batch-blocked',
        status: 'active',
        allow_auto: true,
        allow_direct: true,
        allowed_nodes: [],
        allowed_models: [],
        allowed_endpoints: ['chat_completions'],
        allowed_modalities: [],
      }),
    );

    const res = await harness.agent
      .post('/v1/batches')
      .set('Authorization', `Bearer ${key}`)
      .send({
        input_file_id: 'file-batch-input',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        model: 'gpt-4o-mini',
      });

    expect(res.status).toBe(403);
    expect(harness.fetchMock.calls).toHaveLength(0);
  });

  it('enforces API key modality restrictions for batch', async () => {
    const key = 'e2e-batch-image-only-key';
    await keyRepo.save(
      keyRepo.create({
        name: 'batch-image-only',
        key_hash: createHash('sha256').update(key).digest('hex'),
        key_prefix: 'e2e-batch-image',
        status: 'active',
        allow_auto: true,
        allow_direct: true,
        allowed_nodes: [],
        allowed_models: [],
        allowed_endpoints: ['batch'],
        allowed_modalities: ['image'],
      }),
    );

    const res = await harness.agent
      .post('/v1/batches')
      .set('Authorization', `Bearer ${key}`)
      .send({
        input_file_id: 'file-batch-input',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        model: 'gpt-4o-mini',
      });

    expect(res.status).toBe(403);
    expect(harness.fetchMock.calls).toHaveLength(0);
  });
});
