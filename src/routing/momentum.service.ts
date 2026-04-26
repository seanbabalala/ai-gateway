// ===================================================================
// MomentumService — Session-level tier smoothing
// ===================================================================
// Prevents rapid tier flipping within the same conversation session.
// Uses a sliding window of recent tier assignments and weighted average
// to provide "momentum" — the session tends to stay at a similar tier.
// ===================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Tier } from '../canonical/canonical.types';

// Map tier to numeric value for averaging
const TIER_VALUES: Record<Tier, number> = {
  simple: 0,
  standard: 1,
  complex: 2,
  reasoning: 3,
  direct: 1, // direct routes treated as "standard" for momentum purposes
};

const VALUE_TO_TIER: Tier[] = ['simple', 'standard', 'complex', 'reasoning'];

interface SessionHistory {
  tiers: { tier: Tier; timestamp: number }[];
  lastAccess: number;
}

const MAX_HISTORY = 10;        // Keep last N tier assignments per session
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — expire stale sessions
const MOMENTUM_WEIGHT = 0.3;  // How much history influences current tier (0 = no momentum, 1 = full momentum)

@Injectable()
export class MomentumService {
  private readonly logger = new Logger(MomentumService.name);
  private readonly sessions = new Map<string, SessionHistory>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic cleanup of stale sessions
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Apply momentum smoothing to a tier decision.
   * Takes the scored tier and session key, returns the adjusted tier.
   *
   * If no session key or no history, returns the original tier unchanged.
   */
  apply(scoredTier: Tier, score: number, sessionKey?: string): { tier: Tier; adjusted: boolean } {
    if (!sessionKey) {
      return { tier: scoredTier, adjusted: false };
    }

    const history = this.getHistory(sessionKey);

    if (history.tiers.length === 0) {
      // First request in session — no momentum to apply
      this.recordTier(sessionKey, scoredTier);
      return { tier: scoredTier, adjusted: false };
    }

    // Calculate weighted average of recent tiers
    const recentValues = history.tiers.map((h) => TIER_VALUES[h.tier]);
    const avgValue =
      recentValues.reduce((sum, v) => sum + v, 0) / recentValues.length;

    // Blend: current + momentum
    const currentValue = TIER_VALUES[scoredTier];
    const blended =
      currentValue * (1 - MOMENTUM_WEIGHT) + avgValue * MOMENTUM_WEIGHT;

    // Round to nearest tier
    const adjustedIndex = Math.round(Math.max(0, Math.min(3, blended)));
    const adjustedTier = VALUE_TO_TIER[adjustedIndex];

    // Record the actual (scored) tier in history, not the adjusted one
    this.recordTier(sessionKey, scoredTier);

    if (adjustedTier !== scoredTier) {
      this.logger.debug(
        `Momentum: ${scoredTier} → ${adjustedTier} (session=${sessionKey}, avg=${avgValue.toFixed(2)})`,
      );
    }

    return { tier: adjustedTier, adjusted: adjustedTier !== scoredTier };
  }

  /**
   * Get session history for monitoring/debugging.
   */
  getSessionHistory(sessionKey: string): { tier: Tier; timestamp: number }[] {
    return this.getHistory(sessionKey).tiers;
  }

  private recordTier(sessionKey: string, tier: Tier): void {
    const history = this.getHistory(sessionKey);
    history.tiers.push({ tier, timestamp: Date.now() });
    history.lastAccess = Date.now();

    // Keep only the last N entries
    if (history.tiers.length > MAX_HISTORY) {
      history.tiers = history.tiers.slice(-MAX_HISTORY);
    }
  }

  private getHistory(sessionKey: string): SessionHistory {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, { tiers: [], lastAccess: Date.now() });
    }
    const history = this.sessions.get(sessionKey)!;
    history.lastAccess = Date.now();
    return history;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, history] of this.sessions) {
      if (now - history.lastAccess > SESSION_TTL_MS) {
        this.sessions.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.debug(`Cleaned up ${removed} stale momentum sessions`);
    }
  }
}
