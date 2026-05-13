import * as fs from 'fs';
import * as path from 'path';

const loadedEnvFiles = new Set<string>();

export interface LocalEnvLoadOptions {
  cwd?: string;
  configPath?: string;
  envFile?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadLocalEnvFiles(options: LocalEnvLoadOptions = {}): string[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const candidates = candidateEnvFiles({
    cwd,
    configPath: options.configPath,
    explicitEnvFile: options.envFile ?? env.SIFTGATE_ENV_FILE,
  });
  const loaded: string[] = [];

  for (const candidate of candidates) {
    if (loadedEnvFiles.has(candidate) || !fs.existsSync(candidate)) continue;
    applyEnvFile(candidate, env);
    loadedEnvFiles.add(candidate);
    loaded.push(candidate);
  }

  return loaded;
}

function candidateEnvFiles(input: {
  cwd: string;
  configPath?: string;
  explicitEnvFile?: string;
}): string[] {
  if (input.explicitEnvFile) {
    return [path.resolve(input.cwd, input.explicitEnvFile)];
  }

  const candidates = [path.resolve(input.cwd, '.env')];
  if (input.configPath) {
    const configDirEnv = path.resolve(path.dirname(input.configPath), '.env');
    if (!candidates.includes(configDirEnv)) {
      candidates.push(configDirEnv);
    }
  }
  return candidates;
}

function applyEnvFile(filePath: string, env: NodeJS.ProcessEnv): void {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
    }
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;

  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trimStart()
    : trimmed;
  const equalsIndex = withoutExport.indexOf('=');
  if (equalsIndex <= 0) return undefined;

  const key = withoutExport.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;

  const rawValue = withoutExport.slice(equalsIndex + 1).trim();
  return { key, value: parseEnvValue(rawValue) };
}

function parseEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const unquoted = value.slice(1, -1);
    if (value.startsWith("'")) return unquoted;
    return unquoted
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return stripInlineComment(value).trim();
}

function stripInlineComment(value: string): string {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}
