export type SecretReferenceProvider = "vault" | "aws-sm" | "gcp-sm";

export interface EnvReference {
  raw: string;
  variable: string;
  hasDefault: boolean;
  defaultValue?: string;
}

export interface SecretReference {
  raw: string;
  provider: SecretReferenceProvider;
  target: string;
  field?: string;
}

export interface InvalidConfigReference {
  raw: string;
  expression: string;
  reason: string;
}

export interface ConfigReferenceScan {
  env: EnvReference[];
  secrets: SecretReference[];
  invalid: InvalidConfigReference[];
}

const CONFIG_REF_PATTERN = /\$\{([^}]+)\}/g;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_PROVIDERS = new Set<SecretReferenceProvider>([
  "vault",
  "aws-sm",
  "gcp-sm",
]);

export function scanConfigReferences(value: string): ConfigReferenceScan {
  const env: EnvReference[] = [];
  const secrets: SecretReference[] = [];
  const invalid: InvalidConfigReference[] = [];

  CONFIG_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONFIG_REF_PATTERN.exec(value))) {
    const raw = match[0];
    const expression = match[1].trim();
    const parsed = parseConfigReferenceExpression(raw, expression);
    if (parsed.kind === "env") {
      env.push(parsed.reference);
    } else if (parsed.kind === "secret") {
      secrets.push(parsed.reference);
    } else {
      invalid.push({ raw, expression, reason: parsed.reason });
    }
  }

  return { env, secrets, invalid };
}

export function extractSecretReferences(value: string): SecretReference[] {
  return scanConfigReferences(value).secrets;
}

export function containsSecretReference(value: string): boolean {
  return extractSecretReferences(value).length > 0;
}

export function containsConfigReference(value: string): boolean {
  return /\$\{[^}]*\}/.test(value);
}

function parseConfigReferenceExpression(
  raw: string,
  expression: string,
):
  | { kind: "env"; reference: EnvReference }
  | { kind: "secret"; reference: SecretReference }
  | { kind: "invalid"; reason: string } {
  if (!expression) {
    return { kind: "invalid", reason: "Reference expression is empty." };
  }

  const prefixed = /^([a-z][a-z0-9-]*):([\s\S]+)$/.exec(expression);
  if (prefixed) {
    const prefix = prefixed[1];
    const body = prefixed[2].trim();

    if (prefix === "env") {
      return parseEnvReference(raw, body);
    }

    if (SECRET_PROVIDERS.has(prefix as SecretReferenceProvider)) {
      return parseSecretReference(raw, prefix as SecretReferenceProvider, body);
    }

    return {
      kind: "invalid",
      reason: `Unsupported reference provider "${prefix}".`,
    };
  }

  return parseEnvReference(raw, expression);
}

function parseEnvReference(
  raw: string,
  expression: string,
):
  | { kind: "env"; reference: EnvReference }
  | { kind: "invalid"; reason: string } {
  const splitIndex = expression.indexOf(":-");
  const variable =
    splitIndex === -1
      ? expression.trim()
      : expression.slice(0, splitIndex).trim();
  const defaultValue =
    splitIndex === -1 ? undefined : expression.slice(splitIndex + 2);

  if (!ENV_NAME_PATTERN.test(variable)) {
    return {
      kind: "invalid",
      reason:
        "Environment references must use ${VAR}, ${VAR:-default}, ${env:VAR}, or ${env:VAR:-default} with an uppercase variable name.",
    };
  }

  return {
    kind: "env",
    reference: {
      raw,
      variable,
      hasDefault: defaultValue !== undefined,
      defaultValue,
    },
  };
}

function parseSecretReference(
  raw: string,
  provider: SecretReferenceProvider,
  body: string,
):
  | { kind: "secret"; reference: SecretReference }
  | { kind: "invalid"; reason: string } {
  if (!body) {
    return {
      kind: "invalid",
      reason: `${provider} references must include a secret path or id.`,
    };
  }

  const hashIndex = body.lastIndexOf("#");
  const target = hashIndex === -1 ? body : body.slice(0, hashIndex);
  const field = hashIndex === -1 ? undefined : body.slice(hashIndex + 1);

  if (!target.trim()) {
    return {
      kind: "invalid",
      reason: `${provider} references must include a non-empty secret path or id.`,
    };
  }
  if (field !== undefined && !field.trim()) {
    return {
      kind: "invalid",
      reason: `${provider} reference field selectors must be non-empty when "#" is used.`,
    };
  }

  return {
    kind: "secret",
    reference: {
      raw,
      provider,
      target: target.trim(),
      field: field?.trim(),
    },
  };
}
