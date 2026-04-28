/**
 * Ingest controller tests — ChatCompletions, Messages, Responses.
 *
 * Tests stream vs non-stream branching, error formatting per protocol,
 * header extraction, and budget error handling.
 */

import { ChatCompletionsController } from '../../src/ingest/chat-completions.controller';
import { MessagesController } from '../../src/ingest/messages.controller';
import { ResponsesController } from '../../src/ingest/responses.controller';
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
