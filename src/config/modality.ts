// ===================================================================
// Modality Registry — Model → modality mapping
// ===================================================================
// Defines the modality type system and a known-model inference table.
// Used to determine which modalities (text, vision, audio) a model
// supports based on its name, when no explicit config is provided.
// ===================================================================

export type Modality = 'text' | 'vision' | 'audio';

// ── Known Model → Modality Mapping ────────────────────────────────
// Patterns are checked in order; first match wins.

const KNOWN_MODEL_MODALITIES: { pattern: RegExp; modalities: Modality[] }[] = [
  // ── Text-only models (check specific text-only patterns FIRST) ──
  { pattern: /gpt-3\.5/i, modalities: ['text'] },
  { pattern: /gpt-4-0613/i, modalities: ['text'] },
  { pattern: /o1-mini/i, modalities: ['text'] },
  { pattern: /o1-preview/i, modalities: ['text'] },
  { pattern: /minimax/i, modalities: ['text'] },
  { pattern: /deepseek/i, modalities: ['text'] },

  // ── Vision-capable models ──
  { pattern: /gpt-4o/i, modalities: ['text', 'vision'] },
  { pattern: /gpt-4-turbo/i, modalities: ['text', 'vision'] },
  { pattern: /gpt-4\.5/i, modalities: ['text', 'vision'] },
  { pattern: /gpt-5/i, modalities: ['text', 'vision'] },
  { pattern: /claude-3/i, modalities: ['text', 'vision'] },
  { pattern: /claude-sonnet/i, modalities: ['text', 'vision'] },
  { pattern: /claude-opus/i, modalities: ['text', 'vision'] },
  { pattern: /claude-haiku/i, modalities: ['text', 'vision'] },
  { pattern: /gemini/i, modalities: ['text', 'vision'] },
  { pattern: /pixtral/i, modalities: ['text', 'vision'] },
  { pattern: /llava/i, modalities: ['text', 'vision'] },
  { pattern: /qwen2\.5-vl/i, modalities: ['text', 'vision'] },
  { pattern: /qwen-vl/i, modalities: ['text', 'vision'] },
];

/**
 * Infer supported modalities from a model name using the known-model table.
 * Returns null if the model is not recognized (caller decides the default).
 */
export function inferModelModalities(modelName: string): Modality[] | null {
  for (const entry of KNOWN_MODEL_MODALITIES) {
    if (entry.pattern.test(modelName)) {
      return entry.modalities;
    }
  }
  return null;
}

/** Default modalities for unknown models (conservative: text-only). */
export const DEFAULT_MODALITIES: Modality[] = ['text'];
