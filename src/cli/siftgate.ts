#!/usr/bin/env node
import * as path from 'path';
import {
  ConfigValidationIssue,
  ConfigValidationResult,
  validateConfigFile,
} from '../config/config-validator';
import {
  CommandRunner,
  DEFAULT_PLUGINS_CONFIG,
  ManagedPluginConfigEntry,
  PluginInstallResult,
  PluginManager,
  PluginRemoveResult,
  defaultCommandRunner,
} from './plugin-manager';

interface CliIO {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  runCommand: CommandRunner;
  now: () => Date;
}

interface ValidateArgs {
  configPath?: string;
  json: boolean;
  help: boolean;
}

interface PluginArgs {
  action?: 'install' | 'list' | 'remove';
  target?: string;
  configPath?: string;
  json: boolean;
  help: boolean;
  required?: boolean;
  force: boolean;
  npmInstall: boolean;
}

const DEFAULT_IO: CliIO = {
  cwd: process.cwd(),
  env: process.env,
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
  runCommand: defaultCommandRunner,
  now: () => new Date(),
};

export async function runCli(
  argv: string[] = process.argv.slice(2),
  io: Partial<CliIO> = {},
): Promise<number> {
  const cli = { ...DEFAULT_IO, ...io };
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    cli.stdout(formatUsage());
    return command ? 0 : 1;
  }

  if (command === 'validate') {
    return runValidateCommand(args, cli);
  }

  if (command === 'plugin') {
    return runPluginCommand(args, cli);
  }

  cli.stderr(`Unknown command: ${command}`);
  cli.stderr(formatUsage());
  return 1;
}

function runValidateCommand(args: string[], cli: CliIO): number {
  let parsedArgs: ValidateArgs;
  try {
    parsedArgs = parseValidateArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : 'Invalid arguments.');
    cli.stderr(formatValidateUsage());
    return 1;
  }

  if (parsedArgs.help) {
    cli.stdout(formatValidateUsage());
    return 0;
  }

  const result = validateConfigFile({
    configPath: parsedArgs.configPath,
    cwd: cli.cwd,
    env: cli.env,
  });

  if (parsedArgs.json) {
    cli.stdout(JSON.stringify(toJsonResult(result), null, 2));
  } else {
    cli.stdout(formatValidationResult(result));
  }

  return result.ok ? 0 : 1;
}

async function runPluginCommand(args: string[], cli: CliIO): Promise<number> {
  let parsedArgs: PluginArgs;
  try {
    parsedArgs = parsePluginArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : 'Invalid arguments.');
    cli.stderr(formatPluginUsage());
    return 1;
  }

  if (parsedArgs.help || !parsedArgs.action) {
    cli.stdout(formatPluginUsage());
    return parsedArgs.help ? 0 : 1;
  }

  const manager = new PluginManager({
    cwd: cli.cwd,
    env: cli.env,
    configPath: parsedArgs.configPath,
    runCommand: cli.runCommand,
    now: cli.now,
  });

  try {
    if (parsedArgs.action === 'install') {
      if (!parsedArgs.target) {
        throw new Error('plugin install requires a local path or npm package name.');
      }
      const result = await manager.install(parsedArgs.target, {
        required: parsedArgs.required,
        force: parsedArgs.force,
        npmInstall: parsedArgs.npmInstall,
      });
      cli.stdout(
        parsedArgs.json
          ? JSON.stringify(result, null, 2)
          : formatPluginInstallResult(result),
      );
      return 0;
    }

    if (parsedArgs.action === 'list') {
      const result = manager.list();
      cli.stdout(
        parsedArgs.json
          ? JSON.stringify(result, null, 2)
          : formatPluginListResult(result.configPath, result.entries),
      );
      return 0;
    }

    if (!parsedArgs.target) {
      throw new Error('plugin remove requires a plugin name, package, or path.');
    }
    const result = manager.remove(parsedArgs.target);
    cli.stdout(
      parsedArgs.json
        ? JSON.stringify(result, null, 2)
        : formatPluginRemoveResult(result),
    );
    return 0;
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : 'Plugin command failed.');
    return 1;
  }
}

function parseValidateArgs(args: string[]): ValidateArgs {
  const parsed: ValidateArgs = { json: false, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} requires a path.`);
      }
      parsed.configPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (!value) {
        throw new Error('--config requires a path.');
      }
      parsed.configPath = value;
      continue;
    }
    throw new Error(`Unknown validate option: ${arg}`);
  }

  return parsed;
}

function parsePluginArgs(args: string[]): PluginArgs {
  const parsed: PluginArgs = {
    json: false,
    help: false,
    force: false,
    npmInstall: true,
  };
  const [action, ...rest] = args;

  if (!action || action === '--help' || action === '-h') {
    parsed.help = action === '--help' || action === '-h';
    return parsed;
  }

  if (!['install', 'list', 'remove'].includes(action)) {
    throw new Error(`Unknown plugin command: ${action}`);
  }
  parsed.action = action as PluginArgs['action'];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--optional') {
      parsed.required = false;
      continue;
    }
    if (arg === '--required') {
      parsed.required = true;
      continue;
    }
    if (arg === '--force') {
      parsed.force = true;
      continue;
    }
    if (arg === '--no-npm-install') {
      parsed.npmInstall = false;
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      const value = rest[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} requires a path.`);
      }
      parsed.configPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (!value) {
        throw new Error('--config requires a path.');
      }
      parsed.configPath = value;
      continue;
    }
    if (!parsed.target && !arg.startsWith('-')) {
      parsed.target = arg;
      continue;
    }
    throw new Error(`Unknown plugin option: ${arg}`);
  }

  return parsed;
}

export function formatValidationResult(result: ConfigValidationResult): string {
  const lines = [
    'SiftGate config validation',
    `Config: ${path.resolve(result.configPath)}`,
    '',
    formatIssueGroup('Errors', result.errors),
    '',
    formatIssueGroup('Warnings', result.warnings),
    '',
    formatIssueGroup('Info', result.info),
    '',
    result.ok ? 'Result: OK' : 'Result: FAILED',
  ];

  return lines.join('\n');
}

function formatIssueGroup(
  label: string,
  issues: ConfigValidationIssue[],
): string {
  if (issues.length === 0) {
    return `${label}: none`;
  }

  return [
    `${label} (${issues.length})`,
    ...issues.map((item) => `  - ${formatIssue(item)}`),
  ].join('\n');
}

function formatIssue(issue: ConfigValidationIssue): string {
  const location = issue.path ? `${issue.path}: ` : '';
  return `[${issue.code}] ${location}${issue.message}`;
}

function formatPluginInstallResult(result: PluginInstallResult): string {
  const lines = [
    'SiftGate plugin install',
    `Config: ${result.configPath}`,
    `Plugin: ${entryLabel(result.entry)}`,
    `Source: ${result.entry.source || 'unknown'}`,
    `Path: ${result.entry.path}`,
    `Version: ${result.entry.version || 'unknown'}`,
    `Required: ${result.entry.required !== false ? 'true' : 'false'}`,
    `NPM installed: ${result.npmInstalled ? 'yes' : 'no'}`,
  ];
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:');
    lines.push(...result.warnings.map((warning) => `  - ${warning}`));
  }
  return lines.join('\n');
}

function formatPluginListResult(
  configPath: string,
  entries: ManagedPluginConfigEntry[],
): string {
  if (entries.length === 0) {
    return [
      'SiftGate plugins',
      `Config: ${configPath}`,
      'Plugins: none',
    ].join('\n');
  }

  return [
    'SiftGate plugins',
    `Config: ${configPath}`,
    ...entries.map((entry) =>
      [
        `- ${entryLabel(entry)}`,
        `source=${entry.source || 'unknown'}`,
        `path=${entry.path}`,
        `version=${entry.version || 'unknown'}`,
        `required=${entry.required !== false ? 'true' : 'false'}`,
      ].join(' '),
    ),
  ].join('\n');
}

function formatPluginRemoveResult(result: PluginRemoveResult): string {
  return [
    'SiftGate plugin remove',
    `Config: ${result.configPath}`,
    ...result.removed.map((entry) => `Removed: ${entryLabel(entry)}`),
  ].join('\n');
}

function entryLabel(entry: ManagedPluginConfigEntry): string {
  return entry.name || entry.package || entry.path;
}

function toJsonResult(
  result: ConfigValidationResult,
): Omit<ConfigValidationResult, 'config'> {
  return {
    configPath: result.configPath,
    ok: result.ok,
    issues: result.issues,
    errors: result.errors,
    warnings: result.warnings,
    info: result.info,
  };
}

function formatUsage(): string {
  return [
    'Usage:',
    '  siftgate validate [--config gateway.config.yaml] [--json]',
    `  siftgate plugin install <path|@siftgate/plugin-name> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    `  siftgate plugin list [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    `  siftgate plugin remove <name|package|path> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    '',
    'Commands:',
    '  validate   Validate a SiftGate gateway.config.yaml file',
    '  plugin     Manage plugin declarations and npm/local installs',
  ].join('\n');
}

function formatValidateUsage(): string {
  return [
    'Usage:',
    '  siftgate validate [--config gateway.config.yaml] [--json]',
    '',
    'Options:',
    '  -c, --config <path>   Config file to validate',
    '      --json            Print machine-readable JSON',
    '  -h, --help            Show help',
  ].join('\n');
}

function formatPluginUsage(): string {
  return [
    'Usage:',
    `  siftgate plugin install <path|@siftgate/plugin-name> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    `  siftgate plugin list [--config ${DEFAULT_PLUGINS_CONFIG}] [--json]`,
    `  siftgate plugin remove <name|package|path> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    '',
    'Options:',
    `  -c, --config <path>   Plugin declaration file (default: ${DEFAULT_PLUGINS_CONFIG})`,
    '      --json            Print machine-readable JSON',
    '      --optional        Mark plugin as optional at gateway startup',
    '      --required        Mark plugin as required at gateway startup',
    '      --force           Replace an existing declaration for the same plugin',
    '      --no-npm-install  Only write the declaration for npm packages',
    '  -h, --help            Show help',
  ].join('\n');
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
