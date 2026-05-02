#!/usr/bin/env node
import * as path from 'path';
import {
  ConfigValidationIssue,
  ConfigValidationResult,
  validateConfigFile,
} from '../config/config-validator';
import {
  LiteLlmMigrationResult,
  formatMigrationReport,
  migrateLiteLlmConfigFile,
} from './litellm-migrator';

interface CliIO {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

interface ValidateArgs {
  configPath?: string;
  json: boolean;
  help: boolean;
}

interface MigrateArgs {
  from?: string;
  configPath?: string;
  outputPath?: string;
  overwrite: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

const DEFAULT_IO: CliIO = {
  cwd: process.cwd(),
  env: process.env,
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
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

  if (command === 'migrate') {
    return runMigrateCommand(args, cli);
  }

  cli.stderr(`Unknown command: ${command}`);
  cli.stderr(formatUsage());
  return 1;
}

async function runValidateCommand(args: string[], cli: CliIO): Promise<number> {
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

async function runMigrateCommand(args: string[], cli: CliIO): Promise<number> {
  let parsedArgs: MigrateArgs;
  try {
    parsedArgs = parseMigrateArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : 'Invalid arguments.');
    cli.stderr(formatMigrateUsage());
    return 1;
  }

  if (parsedArgs.help) {
    cli.stdout(formatMigrateUsage());
    return 0;
  }

  if (parsedArgs.from !== 'litellm') {
    cli.stderr('Only --from litellm is supported.');
    cli.stderr(formatMigrateUsage());
    return 1;
  }
  if (!parsedArgs.configPath) {
    cli.stderr('--config is required for migrate.');
    cli.stderr(formatMigrateUsage());
    return 1;
  }

  let result: LiteLlmMigrationResult;
  try {
    result = migrateLiteLlmConfigFile({
      configPath: parsedArgs.configPath,
      cwd: cli.cwd,
      outputPath: parsedArgs.outputPath,
      overwrite: parsedArgs.overwrite,
      write: !parsedArgs.dryRun,
    });
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : 'Migration failed.');
    return 1;
  }

  if (parsedArgs.json) {
    cli.stdout(JSON.stringify(toJsonMigrationResult(result), null, 2));
  } else {
    cli.stdout(formatMigrationReport(result));
    if (parsedArgs.dryRun) {
      cli.stdout('');
      cli.stdout(result.yaml);
    }
  }

  return result.report.incompatible.length === 0 ? 0 : 2;
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

function parseMigrateArgs(args: string[]): MigrateArgs {
  const parsed: MigrateArgs = {
    overwrite: false,
    dryRun: false,
    json: false,
    help: false,
  };

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
    if (arg === '--overwrite') {
      parsed.overwrite = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--from') {
      parsed.from = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--from=')) {
      parsed.from = requireInlineValue(arg, '--from');
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      parsed.configPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      parsed.configPath = requireInlineValue(arg, '--config');
      continue;
    }
    if (arg === '--out' || arg === '-o') {
      parsed.outputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      parsed.outputPath = requireInlineValue(arg, '--out');
      continue;
    }
    throw new Error(`Unknown migrate option: ${arg}`);
  }

  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function requireInlineValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length);
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
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

function toJsonMigrationResult(result: LiteLlmMigrationResult): object {
  return {
    sourcePath: result.sourcePath,
    outputPath: result.outputPath,
    report: result.report,
    config: result.config,
  };
}

function formatUsage(): string {
  return [
    'Usage:',
    '  siftgate validate [--config gateway.config.yaml] [--json]',
    '  siftgate migrate --from litellm --config litellm_config.yaml [--out gateway.config.yaml]',
    '',
    'Commands:',
    '  validate   Validate a SiftGate gateway.config.yaml file',
    '  migrate    Migrate third-party gateway configs into SiftGate format',
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

function formatMigrateUsage(): string {
  return [
    'Usage:',
    '  siftgate migrate --from litellm --config litellm_config.yaml [--out gateway.config.yaml]',
    '',
    'Options:',
    '      --from <source>    Source config type. Currently only "litellm"',
    '  -c, --config <path>   LiteLLM config file to migrate',
    '  -o, --out <path>      Output SiftGate config path (default: gateway.config.yaml)',
    '      --overwrite       Allow overwriting the output file',
    '      --dry-run         Print generated YAML instead of writing it',
    '      --json            Print machine-readable migration report',
    '  -h, --help            Show help',
  ].join('\n');
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
