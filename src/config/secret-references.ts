export type SecretReferenceBackend = 'env' | 'vault' | 'aws-sm' | 'gcp-sm';
export type ExternalSecretReferenceBackend = Exclude<SecretReferenceBackend, 'env'>;

export interface SecretReference {
  raw: string;
  backend: SecretReferenceBackend;
  target: string;
  field?: string;
  defaultValue?: string;
}

export interface InvalidSecretReference {
  raw: string;
  expression: string;
  reason: string;
}

export interface SecretReferenceScan {
  references: SecretReference[];
  invalid: InvalidSecretReference[];
}

const CONFIG_REF_PATTERN = /\$\{([^}]+)\}/g;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const TYPED_BACKENDS = new Set<SecretReferenceBackend>([
  'env',
  'vault',
  'aws-sm',
  'gcp-sm',
]);

export function scanSecretReferences(value: string): SecretReferenceScan {
  const references: SecretReference[] = [];
  const invalid: InvalidSecretReference[] = [];
  CONFIG_REF_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CONFIG_REF_PATTERN.exec(value))) {
    const raw = match[0];
    const expression = match[1].trim();
    const parsed = parseSecretReferenceExpression(raw, expression);
    if ('reference' in parsed) {
      references.push(parsed.reference);
    } else {
      invalid.push({ raw, expression, reason: parsed.reason });
    }
  }

  if (value.replace(CONFIG_REF_PATTERN, '').includes('}')) {
    invalid.push({
      raw: '}',
      expression: '}',
      reason: 'String contains a closing "}" without a matching secret reference.',
    });
  }

  return { references, invalid };
}

export function extractSecretReferences(value: string): SecretReference[] {
  return scanSecretReferences(value).references;
}

export function containsSecretReference(value: string): boolean {
  return extractSecretReferences(value).length > 0;
}

export function isTypedSecretReferenceExpression(expression: string): boolean {
  const prefix = /^([a-z][a-z0-9-]*):/.exec(expression.trim())?.[1];
  return Boolean(prefix && TYPED_BACKENDS.has(prefix as SecretReferenceBackend));
}

export function isSecretReferenceValue(value: string): boolean {
  const scan = scanSecretReferences(value);
  return scan.references.length > 0 && value.trim() === scan.references[0]?.raw;
}

export function maskSecretForDisplay(value: string | undefined | null): string {
  if (!value) return '[not set]';
  if (containsSecretReference(value)) return value;
  if (value.length <= 8) return '[redacted]';
  return `${value.slice(0, 8)}...`;
}

function parseSecretReferenceExpression(
  raw: string,
  expression: string,
): { reference: SecretReference } | { reason: string } {
  if (!expression) {
    return { reason: 'Reference expression is empty.' };
  }

  const typed = /^([a-z][a-z0-9-]*):([\s\S]+)$/.exec(expression);
  if (typed) {
    const backend = typed[1] as SecretReferenceBackend;
    const body = typed[2].trim();
    if (!TYPED_BACKENDS.has(backend)) {
      return { reason: `Unsupported secret reference backend "${typed[1]}".` };
    }
    if (backend === 'env') {
      return parseEnvReference(raw, body);
    }
    return parseExternalReference(raw, backend, body);
  }

  return parseEnvReference(raw, expression);
}

function parseEnvReference(
  raw: string,
  expression: string,
): { reference: SecretReference } | { reason: string } {
  const splitIndex = expression.indexOf(':-');
  const target =
    splitIndex === -1
      ? expression.trim()
      : expression.slice(0, splitIndex).trim();
  const defaultValue =
    splitIndex === -1 ? undefined : expression.slice(splitIndex + 2);

  if (!ENV_NAME_PATTERN.test(target)) {
    return {
      reason:
        'Environment references must use ${VAR}, ${VAR:-default}, ${env:VAR}, or ${env:VAR:-default} with an uppercase variable name.',
    };
  }

  return {
    reference: {
      raw,
      backend: 'env',
      target,
      defaultValue,
    },
  };
}

function parseExternalReference(
  raw: string,
  backend: ExternalSecretReferenceBackend,
  body: string,
): { reference: SecretReference } | { reason: string } {
  if (!body) {
    return {
      reason: `${backend} references must include a secret path or id.`,
    };
  }

  const hashIndex = body.lastIndexOf('#');
  const target = hashIndex === -1 ? body : body.slice(0, hashIndex);
  const field = hashIndex === -1 ? undefined : body.slice(hashIndex + 1);

  if (!target.trim()) {
    return {
      reason: `${backend} references must include a non-empty secret path or id.`,
    };
  }
  if (field !== undefined && !field.trim()) {
    return {
      reason: `${backend} reference field selectors must be non-empty when "#" is used.`,
    };
  }

  return {
    reference: {
      raw,
      backend,
      target: target.trim(),
      field: field?.trim(),
    },
  };
}
