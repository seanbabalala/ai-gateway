import { findSecretLikeValues, validateK8sAssets } from '../../scripts/validate-k8s';

describe('Kubernetes and Helm deployment assets', () => {
  it('passes local manifest validation', () => {
    const result = validateK8sAssets(process.cwd());
    expect(result.errors).toEqual([]);
    expect(result.info).toContain('Kubernetes and Helm deployment assets passed validation.');
  });

  it('detects real-looking provider secrets while allowing placeholders', () => {
    expect(findSecretLikeValues('OPENAI_API_KEY: "REPLACE_ME"')).toEqual([]);
    expect(findSecretLikeValues('api_key: "${OPENAI_API_KEY:-placeholder-set-me}"')).toEqual([]);
    expect(findSecretLikeValues('OPENAI_API_KEY: "sk-realSecretValue1234567890"')).toEqual([
      'sk-realSecretValue1234567890',
    ]);
  });
});
