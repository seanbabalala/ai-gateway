import { PromptCacheService } from '../../src/cache/prompt-cache.service';
import { mockConfigService, makeRequest, makeCanonicalResponse } from '../helpers';

function makeService(cacheOverrides: Record<string, unknown> = {}): PromptCacheService {
  const config = mockConfigService({
    cache: {
      enabled: true,
      ttl_seconds: 300,
      max_entries: 1000,
      exclude_tool_use: true,
      ...cacheOverrides,
    },
  });
  return new PromptCacheService(config);
}

describe('PromptCacheService', () => {
  // ── shouldCache ──────────────────────────────────────────

  describe('shouldCache', () => {
    it('should return false when cache is disabled', () => {
      const svc = makeService({ enabled: false });
      const req = makeRequest('hello', { temperature: 0 });
      expect(svc.shouldCache(req)).toBe(false);
    });

    it('should return false when temperature > 0', () => {
      const svc = makeService();
      const req = makeRequest('hello', { temperature: 0.7 });
      expect(svc.shouldCache(req)).toBe(false);
    });

    it('should return true when temperature is 0', () => {
      const svc = makeService();
      const req = makeRequest('hello', { temperature: 0 });
      expect(svc.shouldCache(req)).toBe(true);
    });

    it('should return true when temperature is undefined (defaults deterministic)', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      expect(svc.shouldCache(req)).toBe(true);
    });

    it('should return false when there are no messages', () => {
      const svc = makeService();
      const req = makeRequest('', { messages: [] });
      expect(svc.shouldCache(req)).toBe(false);
    });
  });

  // ── lookup ───────────────────────────────────────────────

  describe('lookup', () => {
    it('should return null on cache miss', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      expect(svc.lookup(req)).toBeNull();
    });

    it('should return cached response on hit', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      const resp = makeCanonicalResponse();

      svc.store(req, resp);
      const hit = svc.lookup(req);
      expect(hit).not.toBeNull();
      expect(hit!.id).toBe(resp.id);
      expect(hit!.content).toEqual(resp.content);
    });

    it('should return null when TTL has expired', () => {
      const svc = makeService({ ttl_seconds: 1 });
      const req = makeRequest('hello');
      const resp = makeCanonicalResponse();

      // Store the response
      svc.store(req, resp);

      // Mock time forward past TTL
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 2000); // 2 seconds later

      expect(svc.lookup(req)).toBeNull();

      jest.restoreAllMocks();
    });

    it('should return deep clone (not same reference)', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      const resp = makeCanonicalResponse();

      svc.store(req, resp);
      const hit1 = svc.lookup(req);
      const hit2 = svc.lookup(req);

      expect(hit1).not.toBe(hit2); // different objects
      expect(hit1).toEqual(hit2);  // same content
    });

    it('should return null when cache is disabled', () => {
      const svc = makeService({ enabled: false });
      // Can't actually store when disabled, so lookup should also return null
      const req = makeRequest('hello');
      expect(svc.lookup(req)).toBeNull();
    });
  });

  // ── store ────────────────────────────────────────────────

  describe('store', () => {
    it('should store and retrieve a response', () => {
      const svc = makeService();
      const req = makeRequest('test prompt');
      const resp = makeCanonicalResponse();

      svc.store(req, resp);
      expect(svc.getStats().entries).toBe(1);
    });

    it('should exclude tool_use responses when configured', () => {
      const svc = makeService({ exclude_tool_use: true });
      const req = makeRequest('hello');
      const resp = makeCanonicalResponse({ stop_reason: 'tool_use' });

      svc.store(req, resp);
      expect(svc.getStats().entries).toBe(0);
    });

    it('should enforce LRU eviction at max_entries', () => {
      const svc = makeService({ max_entries: 2 });

      const req1 = makeRequest('prompt1');
      const req2 = makeRequest('prompt2');
      const req3 = makeRequest('prompt3');
      const resp = makeCanonicalResponse();

      svc.store(req1, resp);
      svc.store(req2, resp);
      svc.store(req3, resp);

      expect(svc.getStats().entries).toBe(2);
      // req1 should be evicted (oldest)
      expect(svc.lookup(req1)).toBeNull();
      // req2 and req3 should still exist
      expect(svc.lookup(req2)).not.toBeNull();
      expect(svc.lookup(req3)).not.toBeNull();
    });

    it('should reject responses larger than 1MB', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      // Create a large response (> 1MB when stringified * 2 for UTF-16 estimate)
      const bigText = 'x'.repeat(600_000); // 600KB * 2 = 1.2MB
      const resp = makeCanonicalResponse({
        content: [{ type: 'text', text: bigText }],
      });

      svc.store(req, resp);
      expect(svc.getStats().entries).toBe(0);
    });
  });

  // ── clear ────────────────────────────────────────────────

  describe('clear', () => {
    it('should remove all entries and reset stats', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      const resp = makeCanonicalResponse();

      svc.store(req, resp);
      svc.lookup(req); // 1 hit
      svc.lookup(makeRequest('miss')); // 1 miss

      svc.clear();

      const stats = svc.getStats();
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });
  });

  // ── getStats ─────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct stats', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      const resp = makeCanonicalResponse();

      svc.store(req, resp);
      svc.lookup(req);               // hit
      svc.lookup(makeRequest('no'));  // miss

      const stats = svc.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.entries).toBe(1);
      expect(stats.maxEntries).toBe(1000);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });
  });

  // ── buildKey ─────────────────────────────────────────────

  describe('buildKey', () => {
    it('should produce deterministic keys for same input', () => {
      const svc = makeService();
      const req = makeRequest('hello');
      expect(svc.buildKey(req)).toBe(svc.buildKey(req));
    });

    it('should produce different keys for different messages', () => {
      const svc = makeService();
      const req1 = makeRequest('hello');
      const req2 = makeRequest('world');
      expect(svc.buildKey(req1)).not.toBe(svc.buildKey(req2));
    });

    it('should isolate keys by api_key_name', () => {
      const svc = makeService();
      const req1 = makeRequest('hello');
      const req2 = makeRequest('hello');
      req1.metadata.api_key_name = 'team-a';
      req2.metadata.api_key_name = 'team-b';

      expect(svc.buildKey(req1)).not.toBe(svc.buildKey(req2));
    });

    it('should isolate keys by session_key', () => {
      const svc = makeService();
      const req1 = makeRequest('hello', { sessionKey: 'session-a' });
      const req2 = makeRequest('hello', { sessionKey: 'session-b' });

      expect(svc.buildKey(req1)).not.toBe(svc.buildKey(req2));
    });

    it('should isolate keys by routing-relevant headers', () => {
      const svc = makeService();
      const req1 = makeRequest('hello');
      const req2 = makeRequest('hello');
      req1.metadata.raw_headers = { 'anthropic-beta': 'claude-code-20250219' };
      req2.metadata.raw_headers = { 'anthropic-beta': 'context-management-2025-06-27' };

      expect(svc.buildKey(req1)).not.toBe(svc.buildKey(req2));
    });

    it('should produce a SHA-256 hex string (64 chars)', () => {
      const svc = makeService();
      const key = svc.buildKey(makeRequest('test'));
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
