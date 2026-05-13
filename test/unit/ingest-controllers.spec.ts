/**
 * Ingest controller tests — ChatCompletions, Messages, Responses.
 *
 * Tests stream vs non-stream branching, error formatting per protocol,
 * header extraction, and budget error handling.
 */

import { ChatCompletionsController } from '../../src/ingest/chat-completions.controller';
import { MessagesController } from '../../src/ingest/messages.controller';
import { ResponsesController } from '../../src/ingest/responses.controller';
import { EmbeddingsController } from '../../src/ingest/embeddings.controller';
import { RerankController } from '../../src/ingest/rerank.controller';
import { MediaController } from '../../src/ingest/media.controller';
import { BudgetExceededError } from '../../src/budget/budget.service';

function mockReq(body: Record<string, unknown>, reqHeaders: Record<string, string> = {}): any {
  return {
    body,
    headers: { 'content-type': 'application/json', ...reqHeaders },
    apiKeyName: 'default',
  };
}

function mockRes(): any {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    headersSent: false,
  };
  return res;
}

function mockPipeline(overrides: Record<string, any> = {}): any {
  return {
    process: jest.fn().mockResolvedValue({ statusCode: 200, body: { id: 'test' } }),
    processEmbeddings: jest.fn().mockResolvedValue({ statusCode: 200, body: { object: 'list', data: [] } }),
    processRerank: jest.fn().mockResolvedValue({ statusCode: 200, body: { object: 'rerank', results: [] } }),
    processMedia: jest.fn().mockResolvedValue({ statusCode: 200, body: { created: 123, data: [] }, contentType: 'application/json' }),
    processStream: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// ChatCompletionsController
// ═══════════════════════════════════════════════════════════

describe('ChatCompletionsController', () => {
  it('should handle non-stream request', async () => {
    const pipeline = mockPipeline();
    const controller = new ChatCompletionsController(pipeline);

    const req = mockReq({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(pipeline.process).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: 'test' });
  });

  it('should handle stream request', async () => {
    const pipeline = mockPipeline();
    const controller = new ChatCompletionsController(pipeline);

    const req = mockReq({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(pipeline.processStream).toHaveBeenCalled();
    expect(pipeline.process).not.toHaveBeenCalled();
  });

  it('should return 429 for budget exceeded errors', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new BudgetExceededError('tokens', 1_500_000, 1_000_000)),
    });
    const controller = new ChatCompletionsController(pipeline);

    const req = mockReq({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ type: 'budget_exceeded' }),
    }));
  });

  it('should return 500 for unexpected errors', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new Error('Unexpected crash')),
    });
    const controller = new ChatCompletionsController(pipeline);

    const req = mockReq({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ type: 'internal_error' }),
    }));
  });

  it('should not send error if headers already sent', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new Error('Fail')),
    });
    const controller = new ChatCompletionsController(pipeline);

    const req = mockReq({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();
    res.headersSent = true;

    await controller.handle(req, res);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should extract headers from request', async () => {
    const pipeline = mockPipeline();
    const controller = new ChatCompletionsController(pipeline);

    const req = mockReq(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hi' }], stream: false },
      { 'x-session-id': 'sess_123' },
    );
    const res = mockRes();

    await controller.handle(req, res);

    const canonical = pipeline.process.mock.calls[0][0];
    expect(canonical.metadata.raw_headers['x-session-id']).toBe('sess_123');
  });
});

// ═══════════════════════════════════════════════════════════
// EmbeddingsController
// ═══════════════════════════════════════════════════════════

describe('EmbeddingsController', () => {
  it('should handle OpenAI-compatible embeddings requests', async () => {
    const pipeline = mockPipeline();
    const controller = new EmbeddingsController(pipeline);

    const req = mockReq({
      model: 'auto',
      input: ['hello', 'world'],
      dimensions: 1536,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(pipeline.processEmbeddings).toHaveBeenCalled();
    const canonical = pipeline.processEmbeddings.mock.calls[0][0];
    expect(canonical).toMatchObject({
      model: 'auto',
      input: ['hello', 'world'],
      dimensions: 1536,
      metadata: expect.objectContaining({ source_format: 'embeddings' }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ object: 'list', data: [] });
  });
});

// ═══════════════════════════════════════════════════════════
// RerankController
// ═══════════════════════════════════════════════════════════

describe('RerankController', () => {
  it('should handle OpenAI/common-compatible rerank requests', async () => {
    const pipeline = mockPipeline();
    const controller = new RerankController(pipeline);

    const req = mockReq({
      model: 'auto',
      query: 'what is siftgate?',
      documents: ['gateway', 'database'],
      top_n: 1,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(pipeline.processRerank).toHaveBeenCalled();
    const canonical = pipeline.processRerank.mock.calls[0][0];
    expect(canonical).toMatchObject({
      model: 'auto',
      query: 'what is siftgate?',
      documents: ['gateway', 'database'],
      top_n: 1,
      metadata: expect.objectContaining({ source_format: 'rerank' }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ object: 'rerank', results: [] });
  });
});

// ═══════════════════════════════════════════════════════════
// MediaController
// ═══════════════════════════════════════════════════════════

describe('MediaController', () => {
  it('should handle image generation requests', async () => {
    const pipeline = mockPipeline();
    const controller = new MediaController(pipeline);
    const req = mockReq({
      model: 'auto',
      prompt: 'Draw SiftGate',
    });
    const res = mockRes();

    await controller.imageGenerations(req, res);

    expect(pipeline.processMedia).toHaveBeenCalled();
    const canonical = pipeline.processMedia.mock.calls[0][0];
    expect(canonical).toMatchObject({
      model: 'auto',
      source_format: 'image_generation',
      payload: { model: 'auto', prompt: 'Draw SiftGate' },
      metadata: expect.objectContaining({ source_format: 'image_generation' }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ created: 123, data: [] });
  });

  it('should send binary audio speech responses with the provider content type', async () => {
    const pipeline = mockPipeline({
      processMedia: jest.fn().mockResolvedValue({
        statusCode: 200,
        body: Buffer.from('audio-bytes'),
        contentType: 'audio/mpeg',
      }),
    });
    const controller = new MediaController(pipeline);
    const req = mockReq({
      model: 'tts-1',
      input: 'hello',
      voice: 'alloy',
    });
    const res = mockRes();

    await controller.audioSpeech(req, res);

    expect(pipeline.processMedia).toHaveBeenCalled();
    const canonical = pipeline.processMedia.mock.calls[0][0];
    expect(canonical.source_format).toBe('audio_speech');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('audio/mpeg');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('audio-bytes'));
  });

  it('should route image variations and audio translations through the media pipeline', async () => {
    const pipeline = mockPipeline();
    const controller = new MediaController(pipeline);
    const imageReq = mockReq({ model: 'auto', size: '1024x1024' });
    const audioReq = mockReq({ model: 'auto', response_format: 'json' });
    const res = mockRes();

    await controller.imageVariations(imageReq, res);
    await controller.audioTranslations(audioReq, res);

    expect(pipeline.processMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source_format: 'image_variation',
        media: expect.objectContaining({ media_type: 'image', operation: 'variation' }),
      }),
      expect.any(Object),
    );
    expect(pipeline.processMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source_format: 'audio_translation',
        media: expect.objectContaining({ media_type: 'audio', operation: 'translation' }),
      }),
      expect.any(Object),
    );
  });
});

// ═══════════════════════════════════════════════════════════
// MessagesController
// ═══════════════════════════════════════════════════════════

describe('MessagesController', () => {
  it('should handle non-stream messages request', async () => {
    const pipeline = mockPipeline();
    const controller = new MessagesController(pipeline);

    const req = mockReq({
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(pipeline.process).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should handle stream messages request', async () => {
    const pipeline = mockPipeline();
    const controller = new MessagesController(pipeline);

    const req = mockReq({
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });
    const res = mockRes();

    await controller.handle(req, res);
    expect(pipeline.processStream).toHaveBeenCalled();
  });

  it('should format budget error in Anthropic style', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new BudgetExceededError('tokens', 1_500_000, 1_000_000)),
    });
    const controller = new MessagesController(pipeline);

    const req = mockReq({
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      error: expect.objectContaining({ type: 'budget_exceeded' }),
    }));
  });

  it('should format generic errors in Anthropic style', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new Error('Crash')),
    });
    const controller = new MessagesController(pipeline);

    const req = mockReq({
      model: 'claude-3-opus',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      error: expect.objectContaining({ type: 'internal_error' }),
    }));
  });
});

// ═══════════════════════════════════════════════════════════
// ResponsesController
// ═══════════════════════════════════════════════════════════

describe('ResponsesController', () => {
  it('should handle non-stream responses request', async () => {
    const pipeline = mockPipeline();
    const controller = new ResponsesController(pipeline);

    const req = mockReq({
      model: 'gpt-4.1',
      input: 'Hello!',
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(pipeline.process).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should use the pipeline request id for successful responses headers', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockResolvedValue({
        statusCode: 200,
        body: { id: 'resp_1' },
        requestId: 'req_pipeline_123',
      }),
    });
    const controller = new ResponsesController(pipeline);

    const req = mockReq({
      model: 'gpt-4.1',
      input: 'Hello!',
      stream: false,
    });
    const res = mockRes();

    await controller.handle(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'x-siftgate-request-id',
      'req_pipeline_123',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'req_pipeline_123',
    );
  });

  it('should handle stream responses request', async () => {
    const pipeline = mockPipeline();
    const controller = new ResponsesController(pipeline);

    const req = mockReq({
      model: 'gpt-4.1',
      input: 'Hello!',
      stream: true,
    });
    const res = mockRes();

    await controller.handle(req, res);
    expect(pipeline.processStream).toHaveBeenCalled();
  });

  it('should format budget error in OpenAI style', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new BudgetExceededError('cost', 15, 10)),
    });
    const controller = new ResponsesController(pipeline);

    const req = mockReq({ model: 'gpt-4.1', input: 'Hi', stream: false });
    const res = mockRes();

    await controller.handle(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ type: 'budget_exceeded' }),
    }));
  });

  it('should return 500 for unexpected errors', async () => {
    const pipeline = mockPipeline({
      process: jest.fn().mockRejectedValue(new Error('Unexpected')),
    });
    const controller = new ResponsesController(pipeline);

    const req = mockReq({ model: 'gpt-4.1', input: 'Hi', stream: false });
    const res = mockRes();

    await controller.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
