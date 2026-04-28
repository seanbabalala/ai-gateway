import { detectRequestModalities } from '../../src/canonical/modality-detection';
import { CanonicalRequest } from '../../src/canonical/canonical.types';

function makeReq(messages: CanonicalRequest['messages']): CanonicalRequest {
  return {
    messages,
    stream: false,
    metadata: { source_format: 'chat_completions', raw_headers: {} },
  };
}

describe('detectRequestModalities', () => {
  it('should always include text', () => {
    const req = makeReq([{ role: 'user', content: 'hello' }]);
    const mods = detectRequestModalities(req);
    expect(mods.has('text')).toBe(true);
    expect(mods.size).toBe(1);
  });

  it('should detect vision from image blocks', () => {
    const req = makeReq([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      },
    ]);
    const mods = detectRequestModalities(req);
    expect(mods.has('text')).toBe(true);
    expect(mods.has('vision')).toBe(true);
  });

  it('should detect vision from nested tool_result image blocks', () => {
    const req = makeReq([
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: [
              { type: 'image', source: { type: 'url', media_type: 'image/jpeg', data: 'http://example.com/img.jpg' } },
            ],
          },
        ],
      },
    ]);
    const mods = detectRequestModalities(req);
    expect(mods.has('vision')).toBe(true);
  });

  it('should return only text for plain string messages', () => {
    const req = makeReq([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Explain quantum computing.' },
      { role: 'assistant', content: 'Quantum computing uses qubits...' },
      { role: 'user', content: 'Tell me more.' },
    ]);
    const mods = detectRequestModalities(req);
    expect(mods.size).toBe(1);
    expect(mods.has('text')).toBe(true);
  });

  it('should handle mixed messages with only some having images', () => {
    const req = makeReq([
      { role: 'user', content: 'hello' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'data' } },
        ],
      },
      { role: 'assistant', content: 'I see an image.' },
    ]);
    const mods = detectRequestModalities(req);
    expect(mods.has('vision')).toBe(true);
    expect(mods.has('text')).toBe(true);
    expect(mods.size).toBe(2);
  });

  it('should not add vision for text-only content blocks', () => {
    const req = makeReq([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first part' },
          { type: 'text', text: 'second part' },
        ],
      },
    ]);
    const mods = detectRequestModalities(req);
    expect(mods.size).toBe(1);
    expect(mods.has('text')).toBe(true);
  });
});
