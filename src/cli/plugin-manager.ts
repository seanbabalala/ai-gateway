import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as yaml from 'js-yaml';
import type { PluginConfigEntry } from '../plugins/types';

export const DEFAULT_PLUGINS_CONFIG = 'plugins.config.yaml';

export type PluginSource = 'local' | 'npm';

export interface ManagedPluginConfigEntry extends PluginConfigEntry {
  name?: string;
  source?: PluginSource;
  package?: string;
  version?: string;
  installed_at?: string;
  gateway?: {
    required?: string;
    checked_with: string;
  };
}

export interface PluginsConfigFile {
  plugins: ManagedPluginConfigEntry[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface PluginManagerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  configPath?: string;
  runCommand?: CommandRunner;
  now?: () => Date;
}

export interface PluginInstallOptions {
  required?: boolean;
  force?: boolean;
  npmInstall?: boolean;
}

export interface PluginInstallResult {
  entry: ManagedPluginConfigEntry;
  configPath: string;
  warnings: string[];
  npmInstalled: boolean;
}

export interface PluginListResult {
  entries: ManagedPluginConfigEntry[];
  configPath: string;
}

export interface PluginRemoveResult {
  removed: ManagedPluginConfigEntry[];
  configPath: string;
}

interface PackageMetadata {
  name?: string;
  version?: string;
  main?: string;
  siftgate?: {
    name?: string;
    gateway?: string;
    gatewayVersion?: string;
  };
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

interface NpmPackageSpec {
  packageName: string;
  versionSpec?: string;
}

const execFileAsync = promisify(execFile);

export const defaultCommandRunner: CommandRunner = async (
  command,
  args,
  options,
) => {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
};

export class PluginManager {
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly runCommand: CommandRunner;
  private readonly now: () => Date;
  private readonly configPath: string;
  private readonly gatewayVersion: string;

  constructor(options: PluginManagerOptions) {
    this.cwd = options.cwd;
    this.env = options.env;
    this.runCommand = options.runCommand || defaultCommandRunner;
    this.now = options.now || (() => new Date());
    this.configPath = path.resolve(
      this.cwd,
      options.configPath || DEFAULT_PLUGINS_CONFIG,
    );
    this.gatewayVersion = readGatewayVersion();
  }

  async install(
    spec: string,
    options: PluginInstallOptions = {},
  ): Promise<PluginInstallResult> {
    if (!spec || spec.trim().length === 0) {
      throw new Error('plugin install requires a local path or npm package name.');
    }

    const trimmedSpec = spec.trim();
    const result = this.isLocalPluginSpec(trimmedSpec)
      ? await this.buildLocalEntry(trimmedSpec, options)
      : await this.buildNpmEntry(trimmedSpec, options);

    const config = this.loadConfig();
    const existingIndex = config.plugins.findIndex((entry) =>
      this.entriesConflict(entry, result.entry),
    );

    if (existingIndex >= 0 && !options.force) {
      const existing = config.plugins[existingIndex];
      throw new Error(
        `Plugin "${this.entryLabel(result.entry)}" is already declared as "${this.entryLabel(existing)}"; remove it first or use --force.`,
      );
    }

    if (existingIndex >= 0) {
      config.plugins[existingIndex] = result.entry;
    } else {
      config.plugins.push(result.entry);
    }

    this.saveConfig(config);
    return result;
  }

  list(): PluginListResult {
    return {
      entries: this.loadConfig().plugins,
      configPath: this.configPath,
    };
  }

  remove(target: string): PluginRemoveResult {
    if (!target || target.trim().length === 0) {
      throw new Error('plugin remove requires a plugin name, package, or path.');
    }

    const needle = target.trim();
    const config = this.loadConfig();
    const removed: ManagedPluginConfigEntry[] = [];
    const kept = config.plugins.filter((entry) => {
      if (this.entryMatchesTarget(entry, needle)) {
        removed.push(entry);
        return false;
      }
      return true;
    });

    if (removed.length === 0) {
      throw new Error(`Plugin "${needle}" is not declared in ${this.configPath}.`);
    }

    this.saveConfig({ plugins: kept });
    return { removed, configPath: this.configPath };
  }

  private async buildLocalEntry(
    spec: string,
    options: PluginInstallOptions,
  ): Promise<PluginInstallResult> {
    const absolutePath = path.resolve(this.cwd, spec);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Local plugin path does not exist: ${absolutePath}`);
    }

    const warnings: string[] = [];
    const metadata = this.readLocalPackageMetadata(absolutePath);
    if (!metadata) {
      warnings.push(
        'No package.json found next to the local plugin; version and gateway compatibility could not be verified.',
      );
    }

    this.assertGatewayCompatible(metadata, warnings);
    const relativePath = normalizePath(path.relative(this.cwd, absolutePath) || '.');
    const requiredRange = getGatewayRange(metadata);

    return {
      entry: stripUndefined({
        name: metadata?.siftgate?.name || metadata?.name || path.basename(absolutePath),
        source: 'local' as const,
        path: relativePath,
        version: metadata?.version,
        required: options.required ?? true,
        installed_at: this.now().toISOString(),
        gateway: requiredRange
          ? { required: requiredRange, checked_with: this.gatewayVersion }
          : { checked_with: this.gatewayVersion },
      }),
      configPath: this.configPath,
      warnings,
      npmInstalled: false,
    };
  }

  private async buildNpmEntry(
    spec: string,
    options: PluginInstallOptions,
  ): Promise<PluginInstallResult> {
    const parsed = parseNpmPackageSpec(spec);
    if (!isOfficialPluginPackage(parsed.packageName)) {
      throw new Error(
        `Only @siftgate/plugin-* packages are supported by the initial plugin registry: ${parsed.packageName}`,
      );
    }

    const metadata = await this.fetchNpmMetadata(spec);
    const warnings: string[] = [];
    this.assertGatewayCompatible(metadata, warnings);

    const shouldInstall = options.npmInstall !== false;
    if (shouldInstall) {
      await this.runCommand('npm', ['install', spec, '--save'], {
        cwd: this.cwd,
        env: this.env,
      });
    }

    const requiredRange = getGatewayRange(metadata);
    return {
      entry: stripUndefined({
        name: metadata.siftgate?.name || metadata.name || parsed.packageName,
        source: 'npm' as const,
        package: parsed.packageName,
        path: parsed.packageName,
        version: metadata.version || parsed.versionSpec,
        required: options.required ?? true,
        installed_at: this.now().toISOString(),
        gateway: requiredRange
          ? { required: requiredRange, checked_with: this.gatewayVersion }
          : { checked_with: this.gatewayVersion },
      }),
      configPath: this.configPath,
      warnings,
      npmInstalled: shouldInstall,
    };
  }

  private async fetchNpmMetadata(spec: string): Promise<PackageMetadata> {
    const result = await this.runCommand('npm', ['view', spec, '--json'], {
      cwd: this.cwd,
      env: this.env,
    });
    try {
      const parsed = JSON.parse(result.stdout) as PackageMetadata | PackageMetadata[];
      const metadata = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!metadata || typeof metadata !== 'object') {
        throw new Error('empty metadata');
      }
      return metadata;
    } catch (err) {
      throw new Error(
        `Failed to parse npm metadata for "${spec}": ${(err as Error).message}`,
      );
    }
  }

  private readLocalPackageMetadata(pluginPath: string): PackageMetadata | null {
    const stat = fs.statSync(pluginPath);
    const packageDir = stat.isDirectory() ? pluginPath : path.dirname(pluginPath);
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return null;

    try {
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageMetadata;
    } catch (err) {
      throw new Error(
        `Failed to parse local plugin package.json at ${packageJsonPath}: ${(err as Error).message}`,
      );
    }
  }

  private assertGatewayCompatible(
    metadata: PackageMetadata | null,
    warnings: string[],
  ): void {
    const range = getGatewayRange(metadata);
    if (!range) {
      warnings.push(
        'Plugin does not declare a SiftGate gateway compatibility range.',
      );
      return;
    }

    if (!satisfiesGatewayRange(this.gatewayVersion, range)) {
      throw new Error(
        `Plugin requires SiftGate ${range}, but this gateway is ${this.gatewayVersion}.`,
      );
    }
  }

  private isLocalPluginSpec(spec: string): boolean {
    const absolute = path.resolve(this.cwd, spec);
    if (fs.existsSync(absolute)) return true;
    if (spec.startsWith('.') || path.isAbsolute(spec)) return true;
    return spec.includes('/') && !spec.startsWith('@');
  }

  private loadConfig(): PluginsConfigFile {
    if (!fs.existsSync(this.configPath)) {
      return { plugins: [] };
    }

    const raw = fs.readFileSync(this.configPath, 'utf8');
    const parsed = yaml.load(raw) as PluginsConfigFile | null;
    if (!parsed) return { plugins: [] };
    if (!Array.isArray(parsed.plugins)) {
      throw new Error(`${this.configPath} must contain a top-level plugins array.`);
    }
    return {
      plugins: parsed.plugins.map((entry) => ({ ...entry })),
    };
  }

  private saveConfig(config: PluginsConfigFile): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const body = yaml.dump(
      {
        plugins: config.plugins,
      },
      {
        noRefs: true,
        lineWidth: 100,
        sortKeys: false,
      },
    );
    fs.writeFileSync(this.configPath, body, 'utf8');
  }

  private entriesConflict(
    existing: ManagedPluginConfigEntry,
    next: ManagedPluginConfigEntry,
  ): boolean {
    const existingKeys = new Set([
      existing.name,
      existing.package,
      existing.path,
    ].filter(Boolean));
    return [next.name, next.package, next.path].some((value) =>
      value ? existingKeys.has(value) : false,
    );
  }

  private entryMatchesTarget(entry: ManagedPluginConfigEntry, target: string): boolean {
    return [entry.name, entry.package, entry.path].some((value) => value === target);
  }

  private entryLabel(entry: ManagedPluginConfigEntry): string {
    return entry.name || entry.package || entry.path;
  }
}

export function parseNpmPackageSpec(spec: string): NpmPackageSpec {
  const scoped = spec.match(/^(@[^/]+\/[^@]+)(?:@(.+))?$/);
  if (scoped) {
    return { packageName: scoped[1], versionSpec: scoped[2] };
  }

  const unscoped = spec.match(/^([^@/]+)(?:@(.+))?$/);
  if (unscoped) {
    return { packageName: unscoped[1], versionSpec: unscoped[2] };
  }

  throw new Error(`Invalid npm package spec: ${spec}`);
}

export function isOfficialPluginPackage(packageName: string): boolean {
  return /^@siftgate\/plugin-[a-z0-9._-]+$/i.test(packageName);
}

export function getGatewayRange(metadata: PackageMetadata | null): string | undefined {
  if (!metadata) return undefined;
  return (
    metadata.siftgate?.gateway ||
    metadata.siftgate?.gatewayVersion ||
    metadata.peerDependencies?.siftgate ||
    metadata.engines?.siftgate
  );
}

export function satisfiesGatewayRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (!trimmed || trimmed === '*') return true;

  const normalizedVersion = parseVersion(version);
  const alternatives = trimmed.split('||').map((part) => part.trim()).filter(Boolean);
  return alternatives.some((alternative) =>
    alternative.split(/\s+/).every((token) =>
      satisfiesComparator(normalizedVersion, token),
    ),
  );
}

function satisfiesComparator(version: number[], token: string): boolean {
  if (!token || token === '*') return true;

  if (token.startsWith('^')) {
    const base = parseVersion(token.slice(1));
    const upper = base[0] === 0
      ? [0, base[1] + 1, 0]
      : [base[0] + 1, 0, 0];
    return compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0;
  }

  if (token.startsWith('~')) {
    const base = parseVersion(token.slice(1));
    const upper = [base[0], base[1] + 1, 0];
    return compareVersions(version, base) >= 0 && compareVersions(version, upper) < 0;
  }

  const match = token.match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!match) return false;
  const operator = match[1] || '=';
  const expected = parseVersion(match[2]);
  const comparison = compareVersions(version, expected);
  switch (operator) {
    case '>': return comparison > 0;
    case '>=': return comparison >= 0;
    case '<': return comparison < 0;
    case '<=': return comparison <= 0;
    case '=': return comparison === 0;
    default: return false;
  }
}

function parseVersion(value: string): number[] {
  const cleaned = value.trim().replace(/^v/, '').split('-')[0];
  const parts = cleaned.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length === 0 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid semver version: ${value}`);
  }
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function readGatewayVersion(): string {
  const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    return parsed.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result as T;
}
