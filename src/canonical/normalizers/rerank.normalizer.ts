import { CanonicalRerankRequest } from '../canonical.types';
import { normalizeRequestIdentityHeaders } from './request-metadata';

/**
 * Normalizes OpenAI/common-compatible rerank requests into the dedicated
 * rerank canonical shape.
 */
export class RerankNormalizer {
  normalize(body: unknown, headers: Record<string, string>): CanonicalRerankRequest {
    const req =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const documents = Array.isArray(req.documents)
      ? req.documents.filter(
          (document) =>
            typeof document === 'string' ||
            (document !== null &&
              typeof document === 'object' &&
              !Array.isArray(document)),
        )
      : [];

    return {
      model: typeof req.model === 'string' ? req.model : 'auto',
      query: typeof req.query === 'string' ? req.query : '',
      documents: documents as CanonicalRerankRequest['documents'],
      top_n:
        typeof req.top_n === 'number' && Number.isFinite(req.top_n)
          ? req.top_n
          : undefined,
      return_documents:
        typeof req.return_documents === 'boolean'
          ? req.return_documents
          : undefined,
      metadata: {
        source_format: 'rerank',
        original_model: typeof req.model === 'string' ? req.model : 'auto',
        ...normalizeRequestIdentityHeaders(headers),
        raw_headers: headers,
        raw_body: req,
      },
    };
  }
}
