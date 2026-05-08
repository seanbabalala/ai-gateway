import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const nodeIcon = readFileSync(
  fileURLToPath(new URL('../src/components/shared/NodeIcon.tsx', import.meta.url)),
  'utf8',
)
const nodesPage = readFileSync(
  fileURLToPath(new URL('../src/pages/NodesPage.tsx', import.meta.url)),
  'utf8',
)
const quickReference = readFileSync(
  fileURLToPath(new URL('../src/components/nodes/QuickModelReference.tsx', import.meta.url)),
  'utf8',
)
const nodeForm = readFileSync(
  fileURLToPath(new URL('../src/components/nodes/NodeFormModal.tsx', import.meta.url)),
  'utf8',
)
const catalogPage = readFileSync(
  fileURLToPath(new URL('../src/pages/ProviderCatalogPage.tsx', import.meta.url)),
  'utf8',
)

for (const providerId of [
  'azure-openai',
  'openai',
  'anthropic',
  'google-gemini',
  'google-vertex',
  'openrouter',
  'groq',
  'mistral',
  'deepseek',
  'xai',
  'cohere',
  'voyage',
  'jina',
  'together',
  'fireworks',
  'ollama',
  'vllm',
  'aws-bedrock',
  'alibaba-qwen',
  'baidu-qianfan',
  'volcengine-ark',
  'zhipu',
  'moonshot',
  'minimax',
  'tencent-hunyuan',
  '01ai',
  'replicate',
  'perplexity',
  'nvidia-nim',
  'cerebras',
  'sambanova',
  'deepinfra',
  'nebius',
  'novita',
  'friendli',
  'databricks',
  'github-models',
  'huggingface',
  'cloudflare-workers-ai',
  'ibm-watsonx',
  'baseten',
  'lepton',
  'modal',
  'runpod',
  'predibase',
  'lamini',
  'ai21',
  'fal',
  'stability-ai',
  'black-forest-labs',
  'ideogram',
  'luma',
  'runway',
  'pika',
  'elevenlabs',
  'deepgram',
  'assemblyai',
  'cartesia',
  'speechmatics',
  'lm-studio',
  'llama-cpp',
  'huggingface-tgi',
  'sglang',
  'xinference',
  'openai-compatible',
]) {
  if (!nodeIcon.includes(`id: '${providerId}'`)) {
    throw new Error(`Provider icon registry is missing ${providerId}.`)
  }
}

if (nodeIcon.includes("chat_completions: { logo: '/providers/openai.svg'")) {
  throw new Error('chat_completions protocol must not force the OpenAI logo for compatible providers.')
}

if (nodeIcon.includes("responses: { logo: '/providers/openai.svg'")) {
  throw new Error('responses protocol must not force the OpenAI logo for compatible providers.')
}

for (const [label, source, expected] of [
  ['Nodes page', nodesPage, 'baseUrl={node.base_url}'],
  ['Quick model reference', quickReference, 'baseUrl={node.base_url}'],
  ['Add Node wizard', nodeForm, 'baseUrl={preset.base_url}'],
  ['Provider Catalog page', catalogPage, 'baseUrl={provider.base_url}'],
]) {
  if (!source.includes(expected)) {
    throw new Error(`${label} must pass provider base URL into NodeIcon.`)
  }
}

console.log('Open-source Dashboard provider logo identity validated.')
