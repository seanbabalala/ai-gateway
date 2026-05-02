import {
  CanonicalMediaRequest,
  CanonicalMediaSourceFormat,
} from '../canonical.types';

function contentTypeFrom(headers: Record<string, string>): string {
  return headers['content-type'] || headers['Content-Type'] || 'application/json';
}

export function isMultipartContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('multipart/form-data');
}

export function extractMultipartTextField(
  body: Buffer,
  contentType: string,
  fieldName: string,
): string | undefined {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
  if (!boundaryMatch) return undefined;

  const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
  const raw = body.toString('latin1');
  const parts = raw.split(`--${boundary}`);
  for (const part of parts) {
    if (!part.includes(`name="${fieldName}"`)) continue;
    const valueStart = part.indexOf('\r\n\r\n');
    if (valueStart < 0) continue;
    const valueEnd = part.indexOf('\r\n', valueStart + 4);
    const value = part
      .slice(valueStart + 4, valueEnd >= 0 ? valueEnd : undefined)
      .trim();
    return value || undefined;
  }
  return undefined;
}

/**
 * Normalizes OpenAI-compatible images/audio ingress into a small media
 * canonical shape. Multipart bodies are preserved as raw bytes for pass-through;
 * metadata stores only safe request shape data.
 */
export class MediaNormalizer {
  normalize(
    body: unknown,
    headers: Record<string, string>,
    sourceFormat: CanonicalMediaSourceFormat,
  ): CanonicalMediaRequest {
    const contentType = contentTypeFrom(headers);
    if (Buffer.isBuffer(body)) {
      const model =
        extractMultipartTextField(body, contentType, 'model') || 'auto';
      return {
        model,
        source_format: sourceFormat,
        payload: body,
        content_type: contentType,
        is_multipart: isMultipartContentType(contentType),
        metadata: {
          source_format: sourceFormat,
          original_model: model,
          session_key: headers['x-session-id'] || headers['x-session-key'],
          raw_headers: headers,
          raw_body: {
            multipart: true,
            size_bytes: body.length,
            model,
          },
        },
      };
    }

    const req =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const model = typeof req.model === 'string' ? req.model : 'auto';

    return {
      model,
      source_format: sourceFormat,
      payload: req,
      content_type: contentType,
      is_multipart: false,
      metadata: {
        source_format: sourceFormat,
        original_model: model,
        session_key: headers['x-session-id'] || headers['x-session-key'],
        raw_headers: headers,
        raw_body: req,
      },
    };
  }
}
