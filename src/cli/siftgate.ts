#!/usr/bin/env node
import * as path from 'path';
import {
  ConfigValidationIssue,
  ConfigValidationResult,
  validateConfigFile,
} from '../config/config-validator';

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

  if (command !== 'validate') {
    cli.stderr(`Unknown command: ${command}`);
    cli.stderr(formatUsage());
    return 1;
  }

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

function formatUsage(): string {
  return [
    'Usage:',
    '  siftgate validate [--config gateway.config.yaml] [--json]',
    '',
    'Commands:',
    '  validate   Validate a SiftGate gateway.config.yaml file',
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

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
