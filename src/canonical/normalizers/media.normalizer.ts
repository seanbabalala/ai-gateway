import {
  CanonicalMediaMetadata,
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

function mediaTypeFor(sourceFormat: CanonicalMediaSourceFormat): CanonicalMediaMetadata['media_type'] {
  if (sourceFormat.startsWith('image_')) return 'image';
  if (sourceFormat.startsWith('video_')) return 'video';
  return 'audio';
}

function operationFor(sourceFormat: CanonicalMediaSourceFormat): CanonicalMediaMetadata['operation'] {
  switch (sourceFormat) {
    case 'image_generation':
      return 'generation';
    case 'image_edit':
      return 'edit';
    case 'image_variation':
      return 'variation';
    case 'audio_transcription':
      return 'transcription';
    case 'audio_translation':
      return 'translation';
    case 'audio_speech':
      return 'speech';
    default:
      return 'generation';
  }
}

function extractMultipartSafeMetadata(
  body: Buffer,
  contentType: string,
): Pick<CanonicalMediaMetadata, 'file_count' | 'requested_format' | 'response_format'> {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType);
  if (!boundaryMatch) {
    return { file_count: 0, requested_format: null, response_format: null };
  }

  const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
  const raw = body.toString('latin1');
  const parts = raw.split(`--${boundary}`);
  let fileCount = 0;
  const textFields: Record<string, string> = {};

  for (const part of parts) {
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(part)?.[1];
    if (!disposition) continue;
    const name = /name="([^"]+)"/i.exec(disposition)?.[1];
    const hasFilename = /filename="/i.test(disposition);
    if (hasFilename) {
      fileCount++;
      continue;
    }
    if (!name) continue;
    const valueStart = part.indexOf('\r\n\r\n');
    if (valueStart < 0) continue;
    const valueEnd = part.indexOf('\r\n', valueStart + 4);
    const value = part
      .slice(valueStart + 4, valueEnd >= 0 ? valueEnd : undefined)
      .trim();
    if (value) textFields[name] = value;
  }

  return {
    file_count: fileCount,
    requested_format:
      textFields.format ||
      textFields.output_format ||
      textFields.size ||
      textFields.response_format ||
      null,
    response_format: textFields.response_format || null,
  };
}

function buildJsonMediaMetadata(
  req: Record<string, unknown>,
  sourceFormat: CanonicalMediaSourceFormat,
): CanonicalMediaMetadata {
  const responseFormat =
    typeof req.response_format === 'string' ? req.response_format : null;
  const requestedFormat =
    typeof req.format === 'string'
      ? req.format
      : typeof req.output_format === 'string'
        ? req.output_format
        : typeof req.size === 'string'
          ? req.size
          : responseFormat;

  return {
    media_type: mediaTypeFor(sourceFormat),
    operation: operationFor(sourceFormat),
    multipart: false,
    file_count: 0,
    byte_size: Buffer.byteLength(JSON.stringify(req)),
    requested_format: requestedFormat || null,
    response_format: responseFormat,
  };
}

function buildMultipartMediaMetadata(
  body: Buffer,
  contentType: string,
  sourceFormat: CanonicalMediaSourceFormat,
): CanonicalMediaMetadata {
  const multipart = isMultipartContentType(contentType);
  const safe = extractMultipartSafeMetadata(body, contentType);
  return {
    media_type: mediaTypeFor(sourceFormat),
    operation: operationFor(sourceFormat),
    multipart,
    file_count: safe.file_count,
    byte_size: body.length,
    requested_format: safe.requested_format,
    response_format: safe.response_format,
  };
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
      const media = buildMultipartMediaMetadata(body, contentType, sourceFormat);
      return {
        model,
        source_format: sourceFormat,
        payload: body,
        content_type: contentType,
        is_multipart: isMultipartContentType(contentType),
        media,
        metadata: {
          source_format: sourceFormat,
          original_model: model,
          session_key: headers['x-session-id'] || headers['x-session-key'],
          raw_headers: headers,
          media,
          raw_body: {
            multipart: true,
            size_bytes: body.length,
            file_count: media.file_count,
            model,
            media_type: media.media_type,
            operation: media.operation,
            requested_format: media.requested_format,
            response_format: media.response_format,
          },
        },
      };
    }

    const req =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const model = typeof req.model === 'string' ? req.model : 'auto';
    const media = buildJsonMediaMetadata(req, sourceFormat);

    return {
      model,
      source_format: sourceFormat,
      payload: req,
      content_type: contentType,
      is_multipart: false,
      media,
      metadata: {
        source_format: sourceFormat,
        original_model: model,
        session_key: headers['x-session-id'] || headers['x-session-key'],
        raw_headers: headers,
        media,
        raw_body: req,
      },
    };
  }
}
