// ===================================================================
// PromptCacheService — In-memory LRU cache for deterministic responses
// ===================================================================
// Caches CanonicalResponse keyed by SHA-256 hash of request semantics.
// Only caches temperature=0 (deterministic) requests.
// Format-agnostic: caches at the canonical layer, works for all protocols.
//
// Features:
//   - LRU eviction via Map insertion-order trick
//   - TTL expiration (checked lazily on read)
//   - Per-entry size limit (1MB)
//   - Dashboard stats (hit rate, entries, memory)
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '../config/config.service';
import { CacheConfig } from '../config/gateway.config';
import { CanonicalRequest, CanonicalResponse } from '../canonical/canonical.types';

interface CacheEntry {
  response: CanonicalResponse;
  createdAt: number;
  sizeBytes: number;
}

export interface CacheStats {
  enabled: boolean;
  entries: number;
  maxEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  totalSizeBytes: number;
  memoryMb: number;
}

@Injectable()
export class PromptCacheService {
  private readonly logger = new Logger(PromptCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private totalSizeBytes = 0;

  constructor(private readonly config: ConfigService) {}

  // ══════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════

  /**
   * Check if this request is eligible for caching.
   * Call this before lookup/store to avoid unnecessary key computation.
   */
  shouldCache(canonical: CanonicalRequest): boolean {
    const cfg = this.config.cache;
    if (!cfg.enabled) return false;

    // Only cache deterministic requests (temperature = 0 or unset)
    if (canonical.temperature !== undefined && canonical.temperature !== 0) {
      return false;
    }

    // Must have at least one message
    if (!canonical.messages || canonical.messages.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Stream caching is an explicit opt-in because replaying long responses can
   * surprise clients that expect a fresh live provider stream.
   */
  shouldCacheStream(canonical: CanonicalRequest): boolean {
    const cfg = this.config.cache;
    if (!cfg.stream_cache?.enabled) return false;
    return this.shouldCache(canonical);
  }

  /**
   * Look up a cached response. Returns deep-cloned response on hit, null on miss.
   */
  lookup(canonical: CanonicalRequest): CanonicalResponse | null {
    const cfg = this.config.cache;
    if (!cfg.enabled) return null;

    const key = this.buildKey(canonical);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    const age = (Date.now() - entry.createdAt) / 1000;
    if (age > cfg.ttl_seconds) {
      // Expired — evict
      this.evictEntry(key, entry);
      this.misses++;
      return null;
    }

    // LRU touch: delete and re-insert to move to end (most recent)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    this.logger.log(`Cache HIT (key=${key.slice(0, 12)}…, age=${age.toFixed(0)}s)`);

    // Return deep clone to prevent mutation
    return JSON.parse(JSON.stringify(entry.response));
  }

  /**
   * Store a response in the cache.
   */
  store(canonical: CanonicalRequest, response: CanonicalResponse): void {
    const cfg = this.config.cache;
    if (!cfg.enabled) return;
    if (!this.shouldCache(canonical)) return;
    if (!this.shouldStore(response, cfg)) return;

    const key = this.buildKey(canonical);

    // Serialize to measure size
    const json = JSON.stringify(response);
    const sizeBytes = json.length * 2; // rough UTF-16 in-memory estimate

    // Per-entry size limit: 1MB
    if (sizeBytes > 1_048_576) {
      this.logger.debug(`Cache SKIP (response too large: ${(sizeBytes / 1024).toFixed(0)}KB)`);
      return;
    }

    // Evict existing entry for this key (if updating)
    const existing = this.cache.get(key);
    if (existing) {
      this.totalSizeBytes -= existing.sizeBytes;
      this.cache.delete(key);
    }

    // LRU eviction: remove oldest entries until under max
    while (this.cache.size >= cfg.max_entries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        const oldEntry = this.cache.get(oldestKey);
        if (oldEntry) {
          this.totalSizeBytes -= oldEntry.sizeBytes;
        }
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    // Store deep clone
    const entry: CacheEntry = {
      response: JSON.parse(json),
      createdAt: Date.now(),
      sizeBytes,
    };
    this.cache.set(key, entry);
    this.totalSizeBytes += sizeBytes;

    this.logger.log(
      `Cache STORE (key=${key.slice(0, 12)}…, size=${(sizeBytes / 1024).toFixed(1)}KB, entries=${this.cache.size}/${cfg.max_entries})`,
    );
  }

  /**
   * Get cache statistics for dashboard.
   */
  getStats(): CacheStats {
    const cfg = this.config.cache;
    const total = this.hits + this.misses;
    return {
      enabled: cfg.enabled,
      entries: this.cache.size,
      maxEntries: cfg.max_entries,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Number(((this.hits / total) * 100).toFixed(1)) : 0,
      totalSizeBytes: this.totalSizeBytes,
      memoryMb: Number((this.totalSizeBytes / 1_048_576).toFixed(2)),
    };
  }

  /**
   * Clear all cache entries and reset stats.
   */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.totalSizeBytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.logger.log(`Cache cleared (${count} entries removed)`);
  }

  // ══════════════════════════════════════════════════════
  // Internal
  // ══════════════════════════════════════════════════════

  /**
   * Build a deterministic cache key from the semantic parts of a request.
   * Excludes only transient transport details such as the stream flag.
   * Includes caller/routing context so cached responses do not bleed across keys/sessions.
   */
  buildKey(canonical: CanonicalRequest): string {
    const rawHeaders = canonical.metadata.raw_headers || {};
    const keyData = {
      model: canonical.metadata.original_model || 'auto',
      messages: canonical.messages,
      tools: canonical.tools || null,
      tool_choice: canonical.tool_choice || null,
      temperature: canonical.temperature ?? 0,
      top_p: canonical.top_p ?? null,
      stop: canonical.stop || null,
      max_tokens: canonical.max_tokens ?? null,
      request_context: {
        source_format: canonical.metadata.source_format,
        api_key_id: canonical.metadata.api_key_id ?? null,
        api_key_name: canonical.metadata.api_key_name ?? null,
        session_key: canonical.metadata.session_key ?? null,
        routing_headers: {
          'anthropic-version': rawHeaders['anthropic-version'] ?? null,
          'anthropic-beta': rawHeaders['anthropic-beta'] ?? null,
          'user-agent': rawHeaders['user-agent'] ?? null,
        },
      },
    };

    const hash = createHash('sha256')
      .update(JSON.stringify(keyData))
      .digest('hex');

    return hash;
  }

  /**
   * Check if a response should be stored (additional checks beyond shouldCache).
   */
  private shouldStore(response: CanonicalResponse, cfg: CacheConfig): boolean {
    // Skip tool_use responses if configured
    if (cfg.exclude_tool_use && response.stop_reason === 'tool_use') {
      return false;
    }

    return true;
  }

  /**
   * Remove a specific entry and update size tracking.
   */
  private evictEntry(key: string, entry: CacheEntry): void {
    this.cache.delete(key);
    this.totalSizeBytes -= entry.sizeBytes;
  }
}
