import * as path from 'path';
import {
  loadMergedCatalog,
  validateCatalogOverrideFile,
} from '../../src/catalog/catalog.service';

const fixture = (name: string) =>
  path.resolve(__dirname, '../fixtures/catalog', name);

describe('catalog service', () => {
  it('merges local overrides into the built-in provider catalog', () => {
    const result = loadMergedCatalog({
      cwd: path.dirname(fixture('catalog.override.yaml')),
      overridePath: fixture('catalog.override.yaml'),
      env: {},
    });

    const openai = result.catalog.providers.find((provider) => provider.id === 'openai');
    const customModel = openai?.models.find((model) => model.id === 'custom-chat-latest');
    const localLab = result.catalog.providers.find((provider) => provider.id === 'local-lab');

    expect(result.overrideFound).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(openai).toMatchObject({
      base_url: 'https://proxy.example/openai',
      overridden: true,
    });
    expect(customModel).toMatchObject({
      provider: 'openai',
      source: 'override',
      overridden: true,
      pricing: expect.objectContaining({ manual_review_required: false }),
    });
    expect(localLab).toMatchObject({
      name: 'Local Lab',
      auth_type: 'none',
      source: 'override',
      overridden: true,
    });
  });

  it('rejects secret-looking fields in override files', () => {
    const result = validateCatalogOverrideFile(fixture('secret.catalog.override.yaml'));

    expect(result.override).not.toBeNull();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          code: 'catalog_override_secret_field',
        }),
        expect.objectContaining({
          severity: 'warning',
          code: 'catalog_override_secret_value',
        }),
      ]),
    );
  });
});
