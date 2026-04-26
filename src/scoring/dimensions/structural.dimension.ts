// ===================================================================
// Structural Dimensions — tokenCount, conversationDepth,
//                          constraintDensity, expectedOutputLength,
//                          codeToProse, multiStep
// ===================================================================
// These dimensions analyze the structural properties of the request
// rather than keyword content.
// ===================================================================

import { CanonicalRequest } from '../../canonical/canonical.types';
import { extractAllText, extractLastUserText } from './keyword.dimension';

/**
 * tokenCount — Rough token count estimate.
 * Longer inputs generally indicate more complex tasks.
 * Range: [0, 1]
 */
export function scoreTokenCount(req: CanonicalRequest): number {
  const text = extractAllText(req);

  // Rough token estimation:
  // English: ~4 chars per token, Chinese: ~1.5 chars per token
  // We use a blended estimate
  const charCount = text.length;
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = charCount - cjkChars;
  const estimatedTokens = Math.round(nonCjk / 4 + cjkChars / 1.5);

  // Scoring thresholds:
  // < 50 tokens → 0 (very short)
  // 50-200 → 0.2
  // 200-500 → 0.4
  // 500-1000 → 0.6
  // 1000-3000 → 0.8
  // 3000+ → 1.0
  if (estimatedTokens < 50) return 0;
  if (estimatedTokens < 200) return 0.2;
  if (estimatedTokens < 500) return 0.4;
  if (estimatedTokens < 1000) return 0.6;
  if (estimatedTokens < 3000) return 0.8;
  return 1.0;
}

/**
 * conversationDepth — Number of conversation turns.
 * Deep conversations often indicate complex ongoing tasks.
 * Range: [0, 1]
 */
export function scoreConversationDepth(req: CanonicalRequest): number {
  // Count user messages (each user message = 1 turn)
  const userMsgCount = req.messages.filter((m) => m.role === 'user').length;

  // Scoring:
  // 1 turn → 0 (single shot)
  // 2-3 turns → 0.2
  // 4-6 turns → 0.4
  // 7-10 turns → 0.6
  // 11-20 turns → 0.8
  // 20+ turns → 1.0
  if (userMsgCount <= 1) return 0;
  if (userMsgCount <= 3) return 0.2;
  if (userMsgCount <= 6) return 0.4;
  if (userMsgCount <= 10) return 0.6;
  if (userMsgCount <= 20) return 0.8;
  return 1.0;
}

/**
 * constraintDensity — Detects explicit constraints in the prompt.
 * Constraints like "must", "ensure", "no more than", format requirements, etc.
 * Range: [0, 1]
 */
export function scoreConstraintDensity(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text) return 0;

  const lower = text.toLowerCase();

  const constraintPatterns = [
    // English
    /\bmust\b/g, /\bshould\b/g, /\bensure\b/g, /\brequire[ds]?\b/g,
    /\bno more than\b/g, /\bat least\b/g, /\bat most\b/g,
    /\bexactly\b/g, /\bformat\b/g, /\bstrictly\b/g,
    /\bonly\b/g, /\bdo not\b/g, /\bdon't\b/g, /\bnever\b/g,
    /\bwithin \d+/g, /\bunder \d+/g, /\bmaximum\b/g, /\bminimum\b/g,
    // Chinese
    /必须/g, /确保/g, /要求/g, /不能/g, /不要/g, /不超过/g,
    /至少/g, /至多/g, /限制/g, /格式/g, /严格/g, /规范/g,
    /仅/g, /只/g,
  ];

  let totalConstraints = 0;
  for (const pattern of constraintPatterns) {
    const matches = lower.match(pattern);
    if (matches) totalConstraints += matches.length;
  }

  // Normalize: 0 = 0, 1-2 = 0.2, 3-5 = 0.4, 6-10 = 0.7, 10+ = 1.0
  if (totalConstraints === 0) return 0;
  if (totalConstraints <= 2) return 0.2;
  if (totalConstraints <= 5) return 0.4;
  if (totalConstraints <= 10) return 0.7;
  return 1.0;
}

/**
 * expectedOutputLength — Heuristic for expected response length.
 * Detects requests for long-form content (articles, essays, full implementations).
 * Range: [0, 1]
 */
export function scoreExpectedOutputLength(req: CanonicalRequest): number {
  const text = extractLastUserText(req);
  if (!text) return 0;

  const lower = text.toLowerCase();

  // Check for explicit length indicators
  const longIndicators = [
    // English
    'write a full', 'complete implementation', 'detailed explanation',
    'step by step', 'comprehensive', 'in detail', 'elaborate',
    'write an essay', 'write an article', 'full code', 'entire',
    'all the code', 'complete code',
    // Chinese
    '详细', '完整', '全面', '逐步', '一步一步',
    '写一篇', '详解', '完整代码', '全部代码', '详细解释',
  ];

  const shortIndicators = [
    'one word', 'yes or no', 'true or false', 'one sentence',
    'briefly', 'in short', 'tldr', 'tl;dr',
    '一个词', '是否', '简短', '简要', '一句话',
  ];

  let score = 0;

  for (const indicator of longIndicators) {
    if (lower.includes(indicator)) {
      score += 0.25;
    }
  }

  for (const indicator of shortIndicators) {
    if (lower.includes(indicator)) {
      score -= 0.3;
    }
  }

  // Also consider max_tokens hint
  if (req.max_tokens) {
    if (req.max_tokens > 4000) score += 0.3;
    else if (req.max_tokens > 2000) score += 0.15;
    else if (req.max_tokens < 100) score -= 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * codeToProse — Ratio of code blocks to natural language.
 * High code ratio suggests a development task → higher complexity.
 * Range: [0, 1]
 */
export function scoreCodeToProse(req: CanonicalRequest): number {
  const text = extractAllText(req);
  if (!text || text.length < 10) return 0;

  // Detect code-like content
  const codePatterns = [
    /```[\s\S]*?```/g,              // Fenced code blocks
    /`[^`]+`/g,                      // Inline code
    /\b(function|class|const|let|var|import|export|def|return|if|else|for|while)\b/g,
    /[{}\[\]();]/g,                  // Syntax characters
    /=>/g,                           // Arrow functions
    /\.\w+\(/g,                      // Method calls
  ];

  let codeCharCount = 0;
  for (const pattern of codePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      codeCharCount += matches.join('').length;
    }
  }

  const ratio = codeCharCount / text.length;

  // 0-5% → 0, 5-15% → 0.3, 15-30% → 0.6, 30%+ → 1.0
  if (ratio < 0.05) return 0;
  if (ratio < 0.15) return 0.3;
  if (ratio < 0.30) return 0.6;
  return 1.0;
}

/**
 * multiStep — Detects multi-step task indicators.
 * Tasks with numbered steps, "first...then...finally", etc.
 * Range: [0, 1]
 */
export function scoreMultiStep(req: CanonicalRequest): number {
  const text = extractLastUserText(req);
  if (!text) return 0;

  const lower = text.toLowerCase();
  let score = 0;

  // Numbered lists (1. 2. 3. or 1) 2) 3))
  const numberedSteps = lower.match(/(?:^|\n)\s*\d+[.)]\s/gm);
  if (numberedSteps && numberedSteps.length >= 2) {
    score += Math.min(numberedSteps.length * 0.15, 0.6);
  }

  // Sequential connectors
  const sequencePatterns = [
    /\bfirst\b.*\bthen\b/s,
    /\bstep\s*\d/g,
    /\b(first|second|third|fourth|fifth)\b/g,
    // Chinese
    /第[一二三四五六七八九十\d]+步/g,
    /首先.*然后/s,
    /首先/g, /然后/g, /接着/g, /最后/g, /其次/g,
  ];

  for (const pattern of sequencePatterns) {
    if (lower.match(pattern)) {
      score += 0.15;
    }
  }

  // Bullet points
  const bulletPoints = lower.match(/(?:^|\n)\s*[-•*]\s/gm);
  if (bulletPoints && bulletPoints.length >= 3) {
    score += 0.2;
  }

  return Math.min(score, 1.0);
}
