import { CanonicalEmbeddingRequest } from '../canonical.types';
import { normalizeRequestIdentityHeaders } from './request-metadata';

/**
 * Normalizes OpenAI-compatible Embeddings requests into the dedicated
 * embeddings canonical shape.
 */
export class EmbeddingsNormalizer {
  normalize(body: unknown, headers: Record<string, string>): CanonicalEmbeddingRequest {
    const req =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    return {
      model: typeof req.model === 'string' ? req.model : 'auto',
      input: req.input,
      dimensions:
        typeof req.dimensions === 'number' ? req.dimensions : undefined,
      encoding_format:
        typeof req.encoding_format === 'string'
          ? req.encoding_format
          : undefined,
      user: typeof req.user === 'string' ? req.user : undefined,
      metadata: {
        source_format: 'embeddings',
        original_model: typeof req.model === 'string' ? req.model : 'auto',
        ...normalizeRequestIdentityHeaders(headers),
        raw_headers: headers,
        raw_body: req,
      },
    };
  }
}
