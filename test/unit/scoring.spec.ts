import { KeywordTrie } from '../../src/scoring/trie';
import { ScoringService, ScoringResult } from '../../src/scoring/scoring.service';
import {
  scoreSimpleIndicators,
  scoreCodeGeneration,
  scoreCodeFrontend,
  scoreCodeBackend,
  detectCodeDomain,
  scoreFormalLogic,
  scoreTechnicalTerms,
  scoreAnalyticalReasoning,
  extractAllText,
  extractLastUserText,
} from '../../src/scoring/dimensions/keyword.dimension';
import {
  scoreTokenCount,
  scoreConversationDepth,
  scoreConstraintDensity,
  scoreExpectedOutputLength,
  scoreCodeToProse,
  scoreMultiStep,
} from '../../src/scoring/dimensions/structural.dimension';
import { scoreToolCount } from '../../src/scoring/dimensions/tool.dimension';
import { CircuitBreakerService, CircuitState } from '../../src/routing/circuit-breaker.service';
import { MomentumService } from '../../src/routing/momentum.service';
import { CanonicalRequest } from '../../src/canonical/canonical.types';

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function makeRequest(
  userMessage: string,
  opts: {
    systemMessage?: string;
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
    messages?: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }[];
    maxTokens?: number;
    sessionKey?: string;
  } = {},
): CanonicalRequest {
  const messages: CanonicalRequest['messages'] = [];

  if (opts.messages) {
    messages.push(...opts.messages);
  } else {
    if (opts.systemMessage) {
      messages.push({ role: 'system', content: opts.systemMessage });
    }
    messages.push({ role: 'user', content: userMessage });
  }

  return {
    messages,
    tools: opts.tools,
    max_tokens: opts.maxTokens,
    stream: false,
    metadata: {
      source_format: 'chat_completions',
      raw_headers: {},
      session_key: opts.sessionKey,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// KeywordTrie
// ═══════════════════════════════════════════════════════════

describe('KeywordTrie', () => {
  it('should match exact keywords', () => {
    const trie = new KeywordTrie();
    trie.insert('hello');
    trie.insert('world');

    const matches = trie.search('hello world');
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.keyword)).toContain('hello');
    expect(matches.map((m) => m.keyword)).toContain('world');
  });

  it('should be case-insensitive', () => {
    const trie = new KeywordTrie();
    trie.insert('Hello');

    const matches = trie.search('HELLO World');
    expect(matches).toHaveLength(1);
    expect(matches[0].keyword).toBe('hello');
  });

  it('should match phrases', () => {
    const trie = new KeywordTrie();
    trie.insert('good morning');

    const matches = trie.search('Good morning, how are you?');
    expect(matches).toHaveLength(1);
    expect(matches[0].keyword).toBe('good morning');
  });

  it('should respect word boundaries', () => {
    const trie = new KeywordTrie();
    trie.insert('go');

    // "go" should not match inside "golang"
    const matches = trie.search('I use golang for backend');
    expect(matches).toHaveLength(0);
  });

  it('should support weighted keywords', () => {
    const trie = new KeywordTrie();
    trie.insert('critical', 2.0);
    trie.insert('normal', 1.0);

    const score = trie.weightedScore('this is critical and normal');
    expect(score).toBe(3.0); // 2.0 + 1.0
  });

  it('should count unique matches', () => {
    const trie = new KeywordTrie();
    trie.insertAll(['hello', 'world']);

    // "hello" appears twice but should count as 1 unique match
    const count = trie.countMatches('hello hello world');
    expect(count).toBe(2); // 2 unique: hello, world
  });

  it('should match Chinese keywords', () => {
    const trie = new KeywordTrie();
    trie.insert('你好');

    const matches = trie.search('你好世界');
    expect(matches).toHaveLength(1);
    expect(matches[0].keyword).toBe('你好');
  });
});

// ═══════════════════════════════════════════════════════════
// Keyword Dimensions
// ═══════════════════════════════════════════════════════════

describe('Keyword Dimensions', () => {
  describe('scoreSimpleIndicators', () => {
    it('should return negative score for greetings', () => {
      const req = makeRequest('你好');
      expect(scoreSimpleIndicators(req)).toBeLessThan(0);
    });

    it('should return negative score for "hello"', () => {
      const req = makeRequest('hello');
      expect(scoreSimpleIndicators(req)).toBeLessThan(0);
    });

    it('should return 0 for complex text', () => {
      const req = makeRequest('Implement a distributed consensus algorithm using Raft protocol');
      expect(scoreSimpleIndicators(req)).toBe(0);
    });
  });

  describe('scoreCodeGeneration', () => {
    it('should score high for code-related requests', () => {
      const req = makeRequest('Write a TypeScript function to parse JSON and implement error handling with unit tests');
      expect(scoreCodeGeneration(req)).toBeGreaterThan(0);
    });

    it('should score 0 for non-code requests', () => {
      const req = makeRequest('Tell me about the history of Rome');
      expect(scoreCodeGeneration(req)).toBe(0);
    });
  });

  describe('scoreFormalLogic', () => {
    it('should score high for math/proof requests', () => {
      const req = makeRequest('Prove that the square root of 2 is irrational using proof by contradiction');
      expect(scoreFormalLogic(req)).toBeGreaterThan(0);
    });

    it('should score high for Chinese math terms', () => {
      const req = makeRequest('请证明这个定理：微积分基本定理的推导过程');
      expect(scoreFormalLogic(req)).toBeGreaterThan(0);
    });
  });

  describe('scoreTechnicalTerms', () => {
    it('should detect ML/AI terms', () => {
      const req = makeRequest('Explain how transformer attention mechanism works in deep learning neural networks');
      expect(scoreTechnicalTerms(req)).toBeGreaterThan(0);
    });
  });

  describe('scoreAnalyticalReasoning', () => {
    it('should detect analysis tasks', () => {
      const req = makeRequest('Compare and analyze the pros and cons of different architecture patterns for system design');
      expect(scoreAnalyticalReasoning(req)).toBeGreaterThan(0);
    });
  });

  describe('scoreCodeFrontend', () => {
    it('should detect React/Vue frontend tasks', () => {
      const req = makeRequest('Create a React component with Tailwind CSS that renders a responsive card layout');
      expect(scoreCodeFrontend(req)).toBeGreaterThan(0);
    });

    it('should return 0 for backend tasks', () => {
      const req = makeRequest('Configure Kubernetes deployment with PostgreSQL database and Redis cache');
      expect(scoreCodeFrontend(req)).toBe(0);
    });
  });

  describe('scoreCodeBackend', () => {
    it('should detect backend/system tasks', () => {
      const req = makeRequest('Design a NestJS API with PostgreSQL database, Redis caching, and Docker deployment');
      expect(scoreCodeBackend(req)).toBeGreaterThan(0);
    });

    it('should return 0 for pure frontend tasks', () => {
      const req = makeRequest('Make a CSS animation with flexbox layout and dark mode toggle');
      expect(scoreCodeBackend(req)).toBe(0);
    });
  });

  describe('detectCodeDomain', () => {
    it('should detect frontend domain', () => {
      const req = makeRequest('Build a React component with Tailwind CSS, responsive layout, and dark mode using shadcn/ui');
      expect(detectCodeDomain(req)).toBe('frontend');
    });

    it('should detect backend domain', () => {
      const req = makeRequest('Build a REST API with NestJS, PostgreSQL database, Redis cache, and Docker deployment');
      expect(detectCodeDomain(req)).toBe('backend');
    });

    it('should return null for non-code requests', () => {
      const req = makeRequest('Tell me about the history of Rome');
      expect(detectCodeDomain(req)).toBeNull();
    });

    it('should return null for ambiguous code tasks', () => {
      const req = makeRequest('Write some code');
      expect(detectCodeDomain(req)).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Structural Dimensions
// ═══════════════════════════════════════════════════════════

describe('Structural Dimensions', () => {
  describe('scoreTokenCount', () => {
    it('should return 0 for very short text', () => {
      const req = makeRequest('hi');
      expect(scoreTokenCount(req)).toBe(0);
    });

    it('should return higher for longer text', () => {
      const longText = 'This is a moderately long message. '.repeat(30);
      const req = makeRequest(longText);
      expect(scoreTokenCount(req)).toBeGreaterThan(0.2);
    });
  });

  describe('scoreConversationDepth', () => {
    it('should return 0 for single message', () => {
      const req = makeRequest('hello');
      expect(scoreConversationDepth(req)).toBe(0);
    });

    it('should return higher for multi-turn conversations', () => {
      const req = makeRequest('question 5', {
        messages: [
          { role: 'user', content: 'question 1' },
          { role: 'assistant', content: 'answer 1' },
          { role: 'user', content: 'question 2' },
          { role: 'assistant', content: 'answer 2' },
          { role: 'user', content: 'question 3' },
          { role: 'assistant', content: 'answer 3' },
          { role: 'user', content: 'question 4' },
          { role: 'assistant', content: 'answer 4' },
          { role: 'user', content: 'question 5' },
        ],
      });
      expect(scoreConversationDepth(req)).toBeGreaterThanOrEqual(0.4);
    });
  });

  describe('scoreMultiStep', () => {
    it('should detect numbered steps', () => {
      const req = makeRequest('Please do the following:\n1. Set up the database\n2. Create the schema\n3. Seed data\n4. Run tests');
      expect(scoreMultiStep(req)).toBeGreaterThan(0);
    });

    it('should detect sequential connectors', () => {
      const req = makeRequest('First install dependencies, then configure the environment, finally run the server');
      expect(scoreMultiStep(req)).toBeGreaterThan(0);
    });
  });

  describe('scoreConstraintDensity', () => {
    it('should detect constraints', () => {
      const req = makeRequest('You must ensure the output format is JSON. Do not include any comments. The response should be strictly under 100 tokens.');
      expect(scoreConstraintDensity(req)).toBeGreaterThan(0);
    });
  });

  describe('scoreExpectedOutputLength', () => {
    it('should detect long output requests', () => {
      const req = makeRequest('Write a comprehensive detailed explanation of quantum computing, step by step');
      expect(scoreExpectedOutputLength(req)).toBeGreaterThan(0);
    });

    it('should detect short output requests', () => {
      const req = makeRequest('Answer yes or no: is the sky blue?');
      expect(scoreExpectedOutputLength(req)).toBe(0);
    });
  });

  describe('scoreCodeToProse', () => {
    it('should detect code-heavy content', () => {
      const req = makeRequest('Fix this code:\n```typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\nconst result = add(1, 2);\nconsole.log(result);\n```');
      expect(scoreCodeToProse(req)).toBeGreaterThan(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Tool Dimension
// ═══════════════════════════════════════════════════════════

describe('Tool Dimension', () => {
  it('should return 0 for no tools', () => {
    const req = makeRequest('hello');
    expect(scoreToolCount(req)).toBe(0);
  });

  it('should return 0.3 for 1-2 tools', () => {
    const req = makeRequest('use the tool', {
      tools: [
        { name: 'search', description: 'Search the web', parameters: {} },
      ],
    });
    expect(scoreToolCount(req)).toBe(0.3);
  });

  it('should return higher for many tools', () => {
    const tools = Array.from({ length: 8 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Tool ${i}`,
      parameters: {},
    }));
    const req = makeRequest('use tools', { tools });
    expect(scoreToolCount(req)).toBe(0.7);
  });
});

// ═══════════════════════════════════════════════════════════
// ScoringService (integration)
// ═══════════════════════════════════════════════════════════

describe('ScoringService', () => {
  // Create a mock ConfigService
  const mockConfig = {
    routing: {
      scoring: {
        simple_max: -0.1,
        standard_max: 0.08,
        complex_max: 0.35,
      },
      tiers: {},
    },
  } as any;

  const service = new ScoringService(mockConfig, { getDimensions: () => [] } as any);
  service.onModuleInit();

  it('should classify a greeting as simple', () => {
    const req = makeRequest('你好');
    const result = service.score(req);
    expect(result.tier).toBe('simple');
    expect(result.fastPath).toBe('short_simple');
  });

  it('should classify "hello" as simple', () => {
    const req = makeRequest('hello');
    const result = service.score(req);
    expect(result.tier).toBe('simple');
  });

  it('should classify a code task as at least standard', () => {
    const req = makeRequest('Write a TypeScript function that implements binary search on a sorted array');
    const result = service.score(req);
    expect(['standard', 'complex', 'reasoning']).toContain(result.tier);
  });

  it('should classify formal logic as reasoning (fast path)', () => {
    const req = makeRequest('Prove that for all primes p, the square root of p is irrational. Use proof by contradiction and mathematical induction.');
    const result = service.score(req);
    expect(result.tier).toBe('reasoning');
    expect(result.fastPath).toBe('formal_logic');
  });

  it('should ensure tools-present requests are at least standard', () => {
    const req = makeRequest('search for weather', {
      tools: [{ name: 'web_search', description: 'Search', parameters: {} }],
    });
    const result = service.score(req);
    expect(result.tier).not.toBe('simple');
  });

  it('should classify complex multi-step analysis as complex or reasoning', () => {
    const req = makeRequest(
      'I need you to analyze the following distributed system architecture and compare ' +
      'it with three alternative approaches. For each approach:\n' +
      '1. Evaluate the pros and cons\n' +
      '2. Consider scalability and fault tolerance implications\n' +
      '3. Estimate implementation complexity\n' +
      '4. Recommend the best approach with detailed reasoning\n\n' +
      'The system must handle 10M requests per second with eventual consistency guarantees, ' +
      'support horizontal scaling, and ensure high availability across multiple data centers.',
    );
    const result = service.score(req);
    expect(['complex', 'reasoning']).toContain(result.tier);
    expect(result.score).toBeGreaterThan(0.08);
  });

  it('should return dimension breakdown', () => {
    const req = makeRequest('Write a comprehensive API with authentication, database integration, and unit tests');
    const result = service.score(req);
    expect(result.dimensions).toBeDefined();
    expect(typeof result.dimensions.codeGeneration).toBe('number');
    expect(typeof result.dimensions.tokenCount).toBe('number');
  });

  it('should return frontend domain hint for React tasks', () => {
    const req = makeRequest('Build a React component with Tailwind CSS and responsive layout using shadcn/ui');
    const result = service.score(req);
    expect(result.domainHint).toBe('frontend');
  });

  it('should return backend domain hint for API/database tasks', () => {
    const req = makeRequest('Build a NestJS REST API with PostgreSQL database, Redis caching, and Docker deployment');
    const result = service.score(req);
    expect(result.domainHint).toBe('backend');
  });

  it('should return null domain hint for non-code tasks', () => {
    const req = makeRequest('你好');
    const result = service.score(req);
    expect(result.domainHint).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// CircuitBreakerService
// ═══════════════════════════════════════════════════════════

describe('CircuitBreakerService', () => {
  let cb: CircuitBreakerService;

  beforeEach(() => {
    cb = new CircuitBreakerService();
  });

  it('should start in CLOSED state', () => {
    expect(cb.isAvailable('node1')).toBe(true);
    expect(cb.getCircuitState('node1')).toBe(CircuitState.CLOSED);
  });

  it('should remain CLOSED after single failure', () => {
    cb.recordFailure('node1');
    expect(cb.isAvailable('node1')).toBe(true);
    expect(cb.getCircuitState('node1')).toBe(CircuitState.CLOSED);
  });

  it('should open after 3 consecutive failures', () => {
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    expect(cb.isAvailable('node1')).toBe(false);
    expect(cb.getCircuitState('node1')).toBe(CircuitState.OPEN);
  });

  it('should reset failure count on success', () => {
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    cb.recordSuccess('node1');
    cb.recordFailure('node1');
    // Only 1 failure after reset, should still be CLOSED
    expect(cb.isAvailable('node1')).toBe(true);
  });

  it('should track nodes independently', () => {
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    expect(cb.isAvailable('node1')).toBe(false);
    expect(cb.isAvailable('node2')).toBe(true);
  });

  it('should reset a specific node', () => {
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    expect(cb.isAvailable('node1')).toBe(false);
    cb.reset('node1');
    expect(cb.isAvailable('node1')).toBe(true);
  });

  it('should provide node status for dashboard', () => {
    cb.recordFailure('node1');
    cb.recordFailure('node1');
    const status = cb.getNodeStatus('node1');
    expect(status.consecutiveFailures).toBe(2);
    expect(status.state).toBe(CircuitState.CLOSED);
  });
});

// ═══════════════════════════════════════════════════════════
// MomentumService
// ═══════════════════════════════════════════════════════════

describe('MomentumService', () => {
  let momentum: MomentumService;

  beforeEach(() => {
    momentum = new MomentumService();
  });

  afterEach(() => {
    momentum.onModuleDestroy();
  });

  it('should return original tier for first request', () => {
    const { tier, adjusted } = momentum.apply('complex', 0.25, 'session1');
    expect(tier).toBe('complex');
    expect(adjusted).toBe(false);
  });

  it('should return original tier without session key', () => {
    const { tier, adjusted } = momentum.apply('complex', 0.25);
    expect(tier).toBe('complex');
    expect(adjusted).toBe(false);
  });

  it('should smooth tier transitions within a session', () => {
    // Build history of "simple" requests
    momentum.apply('simple', -0.2, 'session1');
    momentum.apply('simple', -0.15, 'session1');
    momentum.apply('simple', -0.18, 'session1');

    // Now a sudden jump to "complex" should be dampened
    const { tier } = momentum.apply('complex', 0.25, 'session1');
    // With MOMENTUM_WEIGHT=0.3, blended = 2 * 0.7 + 0 * 0.3 = 1.4 → rounds to 1 → standard
    expect(tier).toBe('standard');
  });

  it('should not affect different sessions', () => {
    momentum.apply('simple', -0.2, 'session1');
    momentum.apply('simple', -0.15, 'session1');

    // Different session should have no history
    const { tier, adjusted } = momentum.apply('complex', 0.25, 'session2');
    expect(tier).toBe('complex');
    expect(adjusted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Text Extraction Helpers
// ═══════════════════════════════════════════════════════════

describe('Text Extraction', () => {
  it('should extract all text from messages', () => {
    const req = makeRequest('', {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });
    const text = extractAllText(req);
    expect(text).toContain('You are helpful.');
    expect(text).toContain('Hello world');
    expect(text).toContain('Hi there');
  });

  it('should extract last user message', () => {
    const req = makeRequest('', {
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
      ],
    });
    const text = extractLastUserText(req);
    expect(text).toBe('second question');
  });
});
