#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '..');
const target = process.argv[2] || path.join(root, 'test/fixtures/catalog/provider-registry.valid.yaml');
const failures = [];

const secretKeyPattern = /(^|[_-])((api|provider)?[_-]?key|secret|password|authorization|bearer|access[_-]?token|refresh[_-]?token|auth[_-]?token|token)([_-]|$)/i;
const secretValuePattern = /\b(sk-[A-Za-z0-9._~+/-]{12,}|sk_[A-Za-z0-9._~+/-]{12,}|xox[A-Za-z0-9._~+/-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/i;
const validAuthTypes = new Set(['bearer', 'x-api-key', 'custom-header', 'none']);
const validProviderTypes = new Set(['direct', 'aggregator', 'cloud', 'self_hosted', 'media', 'speech', 'local']);
const validStatuses = new Set(['active', 'transport_only', 'deprecated', 'legacy_alias', 'custom']);
const validConfidence = new Set(['high', 'medium', 'low', 'unknown']);

main();

function main() {
  let manifest;
  try {
    manifest = yaml.load(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    fail('<file>', `Cannot read provider registry manifest: ${error.message}`);
    finish();
  }

  validateNoSecrets(manifest, '$');
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('$', 'Manifest must be a YAML object.');
    finish();
  }
  if (manifest.version !== 1) {
    fail('$.version', 'Manifest version must be 1.');
  }
  if (!manifest.providers || typeof manifest.providers !== 'object' || Array.isArray(manifest.providers)) {
    fail('$.providers', 'Manifest must contain a providers object.');
    finish();
  }

  for (const [providerId, provider] of Object.entries(manifest.providers)) {
    validateProvider(providerId, provider);
  }

  finish();
}

function validateProvider(providerId, provider) {
  const basePath = `$.providers.${providerId}`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) {
    fail(basePath, 'Provider id must be lowercase kebab-case.');
  }
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    fail(basePath, 'Provider entry must be an object.');
    return;
  }

  requireString(provider.name, `${basePath}.name`);
  requireString(provider.base_url, `${basePath}.base_url`, { url: true, allowTemplate: true });
  requireString(provider.family, `${basePath}.family`);
  requireEnum(provider.provider_type, validProviderTypes, `${basePath}.provider_type`);
  requireEnum(provider.status || 'custom', validStatuses, `${basePath}.status`);
  requireEnum(provider.auth_type, validAuthTypes, `${basePath}.auth_type`);
  requireNonEmptyObject(provider.endpoints, `${basePath}.endpoints`);
  requireStringArray(provider.compatibility_profiles, `${basePath}.compatibility_profiles`);
  validatePricing(provider.pricing, `${basePath}.pricing`);

  if (!Array.isArray(provider.models) || provider.models.length === 0) {
    fail(`${basePath}.models`, 'Provider must include at least one model.');
    return;
  }
  provider.models.forEach((model, index) => validateModel(model, `${basePath}.models[${index}]`));
}

function validateModel(model, basePath) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    fail(basePath, 'Model entry must be an object.');
    return;
  }
  requireString(model.id, `${basePath}.id`);
  requireStringArray(model.modalities, `${basePath}.modalities`);
  requireNonEmptyObject(model.endpoints, `${basePath}.endpoints`);
  if (model.pricing) validatePricing(model.pricing, `${basePath}.pricing`);
}

function validatePricing(pricing, basePath) {
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
    fail(basePath, 'Pricing must be an object.');
    return;
  }
  requireString(pricing.source, `${basePath}.source`);
  requireString(pricing.source_url, `${basePath}.source_url`, { url: true });
  requireDateLike(pricing.last_updated, `${basePath}.last_updated`);
  requireEnum(pricing.pricing_confidence || 'unknown', validConfidence, `${basePath}.pricing_confidence`);
  if (pricing.manual_review_required !== true && pricing.pricing_confidence !== 'high') {
    fail(
      `${basePath}.manual_review_required`,
      'Pricing must be manual-review-required unless confidence is high.',
    );
  }
}

function requireString(value, fieldPath, options = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(fieldPath, 'Expected a non-empty string.');
    return;
  }
  if (options.url && !looksLikeUrl(value, options.allowTemplate)) {
    fail(fieldPath, 'Expected an http(s) URL.');
  }
}

function requireStringArray(value, fieldPath) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    fail(fieldPath, 'Expected a non-empty string array.');
  }
}

function requireDateLike(value, fieldPath) {
  const normalized =
    value instanceof Date && !Number.isNaN(value.getTime())
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : '';
  if (!normalized.trim() || Number.isNaN(Date.parse(normalized))) {
    fail(fieldPath, 'Expected a valid date string.');
  }
}

function requireNonEmptyObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    fail(fieldPath, 'Expected a non-empty object.');
  }
}

function requireEnum(value, allowed, fieldPath) {
  if (!allowed.has(value)) {
    fail(fieldPath, `Expected one of: ${[...allowed].join(', ')}.`);
  }
}

function looksLikeUrl(value, allowTemplate = false) {
  const normalized = allowTemplate ? value.replace(/\{[a-zA-Z0-9_]+\}/g, 'example') : value;
  try {
    const url = new URL(normalized);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateNoSecrets(value, currentPath) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoSecrets(entry, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && secretValuePattern.test(value)) {
      fail(currentPath, 'Secret-looking value is not allowed in provider registry manifests.');
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    if (secretKeyPattern.test(key)) {
      fail(nextPath, 'Secret-looking field name is not allowed in provider registry manifests.');
    }
    validateNoSecrets(entry, nextPath);
  }
}

function fail(fieldPath, message) {
  failures.push(`${fieldPath}: ${message}`);
}

function finish() {
  if (failures.length > 0) {
    console.error('Provider registry validation failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  console.log(`Provider registry manifest validated: ${path.relative(root, target)}`);
}
