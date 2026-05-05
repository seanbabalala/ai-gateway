import {
  compatibilityEvidence,
  compatibilityFilteredReason,
  getCompatibilityProfile,
  listCompatibilityProfiles,
  resolveNodeCompatibilityProfileIds,
} from '../../src/catalog/compatibility-profiles';
import { loadMergedCatalog } from '../../src/catalog/catalog.service';

describe('provider compatibility profiles', () => {
  it('ships the required built-in profile registry', () => {
    const ids = listCompatibilityProfiles().map((profile) => profile.profile_id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'openai_compatible',
        'openai_responses_compatible',
        'anthropic_messages_compatible',
        'google_gemini_compatible',
        'google_vertex_compatible',
        'aws_bedrock_converse',
        'azure_openai_compatible',
        'huggingface_inference',
        'openrouter_aggregator',
        'cohere_compatible',
        'mistral_compatible',
        'local_ollama',
        'local_vllm',
        'local_tgi',
        'local_lmstudio',
        'media_generation_sync',
        'media_generation_async',
        'speech_transcription',
        'speech_tts',
        'rerank_compatible',
        'embedding_compatible',
      ]),
    );

    for (const profile of listCompatibilityProfiles()) {
      expect(profile.supported_source_formats.length).toBeGreaterThan(0);
      expect(profile.supported_modalities.length).toBeGreaterThan(0);
      expect(profile.endpoint_strategy).toBeTruthy();
    }
  });

  it('assigns valid compatibility profiles to every catalog provider', () => {
    const catalog = loadMergedCatalog({ env: {} }).catalog;

    for (const provider of catalog.providers) {
      expect(provider.compatibility_profiles?.length).toBeGreaterThan(0);
      for (const profileId of provider.compatibility_profiles || []) {
        expect(getCompatibilityProfile(profileId)).toBeDefined();
      }
    }
  });

  it('resolves explicit node overrides before catalog inference', () => {
    const ids = resolveNodeCompatibilityProfileIds({
      id: 'custom-gateway',
      protocol: 'chat_completions',
      base_url: 'https://gateway.example',
      compatibility_profile: ['openai_responses_compatible'],
    });

    expect(ids).toEqual(['openai_responses_compatible']);
  });

  it('records pass-through, downgraded, and unsupported field evidence without request bodies', () => {
    const evidence = compatibilityEvidence({
      node: {
        id: 'anthropic',
        protocol: 'messages',
        base_url: 'https://api.anthropic.com',
      },
      sourceFormat: 'messages',
      requestedModality: 'vision',
      selected: true,
    });

    expect(evidence).toMatchObject({
      provider_id: 'anthropic',
      compatibility_profile: expect.arrayContaining(['anthropic_messages_compatible']),
      selected_reason: 'profile_supported_selected',
      filtered_by_profile_reason: null,
    });
    expect(evidence.passthrough_fields).toEqual(expect.arrayContaining(['thinking', 'stream']));
    expect(evidence.downgraded_fields).toEqual(expect.arrayContaining(['response_format']));
    expect(JSON.stringify(evidence)).not.toContain('prompt');
  });

  it('allows gateway-translated OpenAI chat requests to route to Anthropic Messages fallbacks', () => {
    const profile = getCompatibilityProfile('anthropic_messages_compatible')!;

    expect(profile.supported_source_formats).toEqual(
      expect.arrayContaining(['chat_completions', 'responses', 'messages']),
    );
    expect(
      compatibilityFilteredReason({
        profiles: [profile],
        sourceFormat: 'chat_completions',
        requestedModality: 'text',
      }),
    ).toBeNull();
    expect(profile.downgraded_fields).toContain('response_format');
  });

  it('flags unsupported streaming and multipart strategies', () => {
    const profiles = [getCompatibilityProfile('media_generation_sync')!];

    expect(
      compatibilityFilteredReason({
        profiles,
        sourceFormat: 'image_generation',
        requestedModality: 'image',
        stream: true,
      }),
    ).toBe('compatibility_profile_streaming_unsupported');

    expect(
      compatibilityFilteredReason({
        profiles,
        sourceFormat: 'image_generation',
        requestedModality: 'image',
        multipart: true,
      }),
    ).toBeNull();
  });

  it('treats OpenAI-compatible profiles as safe for batch endpoint probes', () => {
    const profile = getCompatibilityProfile('openai_compatible')!;

    expect(profile.supported_source_formats).toContain('batch');
    expect(profile.supported_modalities).toContain('batch');
    expect(
      compatibilityFilteredReason({
        profiles: [profile],
        sourceFormat: 'batch',
        requestedModality: 'batch',
      }),
    ).toBeNull();
  });
});
