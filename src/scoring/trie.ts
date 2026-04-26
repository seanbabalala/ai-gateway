// ===================================================================
// Keyword Trie — Fast multi-pattern matching for scoring dimensions
// ===================================================================
// Borrowed concept from manifest's scoring engine.
// Supports case-insensitive matching of keyword phrases in text.
// ===================================================================

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  weight: number; // keyword-specific weight multiplier (default 1.0)
}

export interface TrieMatch {
  keyword: string;
  weight: number;
  position: number;
}

export class KeywordTrie {
  private root: TrieNode;

  constructor() {
    this.root = this.createNode();
  }

  private createNode(): TrieNode {
    return { children: new Map(), isEnd: false, weight: 1.0 };
  }

  /**
   * Insert a keyword (or phrase) into the trie.
   * Keywords are lowercased and split by spaces for phrase matching.
   */
  insert(keyword: string, weight = 1.0): void {
    const normalized = keyword.toLowerCase().trim();
    if (!normalized) return;

    let node = this.root;
    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, this.createNode());
      }
      node = node.children.get(char)!;
    }
    node.isEnd = true;
    node.weight = weight;
  }

  /**
   * Insert multiple keywords with the same weight.
   */
  insertAll(keywords: string[], weight = 1.0): void {
    for (const kw of keywords) {
      this.insert(kw, weight);
    }
  }

  /**
   * Search text for all matching keywords. Returns matches with positions.
   * Uses sliding window for phrase matching.
   */
  search(text: string): TrieMatch[] {
    const normalized = text.toLowerCase();
    const matches: TrieMatch[] = [];
    const len = normalized.length;

    for (let i = 0; i < len; i++) {
      let node = this.root;
      let j = i;

      while (j < len && node.children.has(normalized[j])) {
        node = node.children.get(normalized[j])!;
        j++;

        if (node.isEnd) {
          // Check word boundary — keyword should not be part of a larger word
          // CJK characters are self-delimiting (each char is a word unit)
          const matchStr = normalized.slice(i, j);
          const isCjkMatch = this.isCjk(matchStr[0]);

          let boundaryOk: boolean;
          if (isCjkMatch) {
            // CJK keywords: always match (no word boundary needed)
            boundaryOk = true;
          } else {
            // Latin/ASCII keywords: require word boundaries
            const beforeOk = i === 0 || !this.isLatinWordChar(normalized[i - 1]);
            const afterOk = j >= len || !this.isLatinWordChar(normalized[j]);
            boundaryOk = beforeOk && afterOk;
          }

          if (boundaryOk) {
            matches.push({
              keyword: normalized.slice(i, j),
              weight: node.weight,
              position: i,
            });
          }
        }
      }
    }

    return matches;
  }

  /**
   * Count unique keyword matches in text.
   */
  countMatches(text: string): number {
    const matches = this.search(text);
    const unique = new Set(matches.map((m) => m.keyword));
    return unique.size;
  }

  /**
   * Get weighted score from text — sum of (weight × count) for each unique keyword.
   */
  weightedScore(text: string): number {
    const matches = this.search(text);
    const keywordWeights = new Map<string, number>();

    for (const m of matches) {
      if (!keywordWeights.has(m.keyword)) {
        keywordWeights.set(m.keyword, m.weight);
      }
    }

    let score = 0;
    for (const w of keywordWeights.values()) {
      score += w;
    }
    return score;
  }

  private isLatinWordChar(c: string): boolean {
    return /[a-z0-9_]/.test(c);
  }

  private isCjk(c: string): boolean {
    return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c);
  }
}
