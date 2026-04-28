import { inferModelModalities, DEFAULT_MODALITIES } from '../../src/config/modality';

describe('inferModelModalities', () => {
  it('should return text+vision for known vision models', () => {
    expect(inferModelModalities('gpt-4o')).toEqual(['text', 'vision']);
    expect(inferModelModalities('gpt-4-turbo')).toEqual(['text', 'vision']);
    expect(inferModelModalities('claude-3-opus-20240229')).toEqual(['text', 'vision']);
    expect(inferModelModalities('gemini-2.0-flash')).toEqual(['text', 'vision']);
  });

  it('should return text-only for known text-only models', () => {
    expect(inferModelModalities('gpt-3.5-turbo')).toEqual(['text']);
    expect(inferModelModalities('o1-mini')).toEqual(['text']);
    expect(inferModelModalities('o1-preview')).toEqual(['text']);
    expect(inferModelModalities('deepseek-chat')).toEqual(['text']);
  });

  it('should return null for unknown models', () => {
    expect(inferModelModalities('totally-unknown-model')).toBeNull();
    expect(inferModelModalities('my-custom-finetune')).toBeNull();
  });

  it('should be case-insensitive', () => {
    expect(inferModelModalities('GPT-4O')).toEqual(['text', 'vision']);
    expect(inferModelModalities('Claude-3-Opus')).toEqual(['text', 'vision']);
    expect(inferModelModalities('DEEPSEEK-v2')).toEqual(['text']);
  });

  it('should use first-match-wins (gpt-3.5 is text-only, not vision)', () => {
    // gpt-3.5 matches the text-only rule before any vision rule
    expect(inferModelModalities('gpt-3.5-turbo-16k')).toEqual(['text']);
  });

  it('should match claude-sonnet and claude-haiku as vision', () => {
    expect(inferModelModalities('claude-sonnet-4-20250514')).toEqual(['text', 'vision']);
    expect(inferModelModalities('claude-haiku-3.5')).toEqual(['text', 'vision']);
  });

  it('should match pixtral and llava as vision models', () => {
    expect(inferModelModalities('pixtral-large-2411')).toEqual(['text', 'vision']);
    expect(inferModelModalities('llava-v1.6-34b')).toEqual(['text', 'vision']);
  });

  it('should match minimax as text-only', () => {
    expect(inferModelModalities('minimax-01')).toEqual(['text']);
  });
});

describe('DEFAULT_MODALITIES', () => {
  it('should be text-only', () => {
    expect(DEFAULT_MODALITIES).toEqual(['text']);
  });
});
