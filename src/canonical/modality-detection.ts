// ===================================================================
// Request Modality Detection
// ===================================================================
// Scans a CanonicalRequest to detect which modalities the request
// requires (e.g., vision if images are present, audio if audio blocks).
// Used by the scoring and routing layers to ensure the request is
// routed to a node that supports the required modalities.
// ===================================================================

import { CanonicalRequest, CanonicalContentBlock } from './canonical.types';
import { Modality } from '../config/modality';

/**
 * Scan all messages in a CanonicalRequest and detect required modalities.
 * Every request requires 'text'. Image blocks add 'vision'.
 * Future: audio blocks would add 'audio'.
 */
export function detectRequestModalities(req: CanonicalRequest): Set<Modality> {
  const modalities = new Set<Modality>(['text'] as Modality[]);

  for (const msg of req.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        scanBlock(block, modalities);
      }
    }
  }

  return modalities;
}

/**
 * Scan a single content block for modality signals.
 * Also recurses into tool_result blocks that may contain nested content.
 */
function scanBlock(block: CanonicalContentBlock, modalities: Set<Modality>): void {
  if (block.type === 'image') {
    modalities.add('vision');
  }

  // tool_result blocks can contain nested content blocks
  if (block.type === 'tool_result' && Array.isArray(block.content)) {
    for (const nested of block.content) {
      scanBlock(nested, modalities);
    }
  }

  // Future: if (block.type === 'audio') modalities.add('audio');
}
