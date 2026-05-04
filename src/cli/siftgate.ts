#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_CATALOG_OVERRIDE_FILE,
  formatCatalogAsYaml,
  loadMergedCatalog,
  resolveCatalogOverridePath,
  validateCatalogOverrideFile,
} from "../catalog/catalog.service";
import type {
  CatalogIssue,
  CatalogProvider,
  ProviderCatalog,
} from "../catalog/catalog.types";
import {
  ConfigValidationIssue,
  ConfigValidationResult,
  validateConfigFile,
} from "../config/config-validator";
import {
  ConfigMigrationResult,
  MigrationConfigType,
  formatConfigMigrationReport,
  migrateConfigFile,
  supportedMigrationType,
} from "./config-migrator";
import {
  DbMigrationResult,
  formatDbMigrationReport,
  migrateSqliteToPostgres,
} from "./db-migrator";
import {
  CommandRunner,
  DEFAULT_PLUGINS_CONFIG,
  ManagedPluginConfigEntry,
  PluginInstallResult,
  PluginManager,
  PluginRemoveResult,
  defaultCommandRunner,
} from "./plugin-manager";

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
  action?: "install" | "list" | "remove";
  target?: string;
  configPath?: string;
  json: boolean;
  help: boolean;
  required?: boolean;
  force: boolean;
  npmInstall: boolean;
}

interface MigrateArgs {
  from?: string;
  to?: string;
  configPath?: string;
  outputPath?: string;
  overwrite: boolean;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

interface MigrateDbArgs {
  from?: string;
  to?: string;
  sqlitePath?: string;
  postgresUrl?: string;
  backup: boolean;
  backupPath?: string;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
  batchSize?: number;
}

interface CatalogArgs {
  action?: "list" | "show" | "validate" | "export" | "import";
  provider?: string;
  filePath?: string;
  overridePath?: string;
  outputPath?: string;
  force: boolean;
  json: boolean;
  help: boolean;
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

  if (!command || command === "--help" || command === "-h") {
    cli.stdout(formatUsage());
    return command ? 0 : 1;
  }

  if (command === "validate") {
    return runValidateCommand(args, cli);
  }

  if (command === "plugin") {
    return runPluginCommand(args, cli);
  }

  if (command === "catalog") {
    return runCatalogCommand(args, cli);
  }

  if (command === "migrate") {
    return runMigrateCommand(args, cli);
  }

  if (command === "migrate-db") {
    return runMigrateDbCommand(args, cli);
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
    cli.stderr(error instanceof Error ? error.message : "Invalid arguments.");
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

function runCatalogCommand(args: string[], cli: CliIO): number {
  let parsedArgs: CatalogArgs;
  try {
    parsedArgs = parseCatalogArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : "Invalid arguments.");
    cli.stderr(formatCatalogUsage());
    return 1;
  }

  if (parsedArgs.help || !parsedArgs.action) {
    cli.stdout(formatCatalogUsage());
    return parsedArgs.help ? 0 : 1;
  }

  if (parsedArgs.action === "validate") {
    return runCatalogValidateCommand(parsedArgs, cli);
  }

  if (parsedArgs.action === "import") {
    return runCatalogImportCommand(parsedArgs, cli);
  }

  const loaded = loadMergedCatalog({
    cwd: cli.cwd,
    env: cli.env,
    overridePath: parsedArgs.overridePath,
  });

  if (parsedArgs.action === "list") {
    cli.stdout(
      parsedArgs.json
        ? JSON.stringify(loaded.catalog.providers, null, 2)
        : formatCatalogProviderList(loaded.catalog, loaded.overridePath),
    );
    return catalogIssuesHaveErrors(loaded.issues) ? 1 : 0;
  }

  if (parsedArgs.action === "show") {
    if (!parsedArgs.provider) {
      cli.stderr("catalog show requires a provider id.");
      cli.stderr(formatCatalogUsage());
      return 1;
    }
    const provider = loaded.catalog.providers.find(
      (entry) => entry.id === parsedArgs.provider,
    );
    if (!provider) {
      cli.stderr(`Unknown catalog provider: ${parsedArgs.provider}`);
      return 1;
    }
    cli.stdout(
      parsedArgs.json
        ? JSON.stringify(provider, null, 2)
        : formatCatalogProvider(provider, loaded.overridePath),
    );
    return catalogIssuesHaveErrors(loaded.issues) ? 1 : 0;
  }

  if (parsedArgs.action === "export") {
    const output = parsedArgs.json
      ? JSON.stringify(loaded.catalog, null, 2)
      : formatCatalogAsYaml(loaded.catalog);
    if (parsedArgs.outputPath) {
      const outputPath = resolveCliPath(cli.cwd, parsedArgs.outputPath);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, output, "utf8");
      cli.stdout(`Exported merged catalog to ${outputPath}`);
    } else {
      cli.stdout(output.trimEnd());
    }
    return catalogIssuesHaveErrors(loaded.issues) ? 1 : 0;
  }

  cli.stderr(`Unknown catalog command: ${String(parsedArgs.action)}`);
  cli.stderr(formatCatalogUsage());
  return 1;
}

function runCatalogValidateCommand(args: CatalogArgs, cli: CliIO): number {
  const result = args.filePath
    ? validateCatalogOverrideFile(resolveCliPath(cli.cwd, args.filePath))
    : loadMergedCatalog({
        cwd: cli.cwd,
        env: cli.env,
        overridePath: args.overridePath,
      });
  const issues = result.issues;

  if (args.json) {
    cli.stdout(JSON.stringify({ ok: !catalogIssuesHaveErrors(issues), ...result }, null, 2));
  } else {
    cli.stdout(
      formatCatalogValidationResult({
        overridePath:
          "overridePath" in result
            ? result.overridePath
            : resolveCliPath(cli.cwd, args.filePath || DEFAULT_CATALOG_OVERRIDE_FILE),
        overrideFound:
          "overrideFound" in result
            ? result.overrideFound
            : fs.existsSync(resolveCliPath(cli.cwd, args.filePath || DEFAULT_CATALOG_OVERRIDE_FILE)),
        issues,
      }),
    );
  }

  return catalogIssuesHaveErrors(issues) ? 1 : 0;
}

function runCatalogImportCommand(args: CatalogArgs, cli: CliIO): number {
  if (!args.filePath) {
    cli.stderr("catalog import requires --file <catalog.override.yaml>.");
    cli.stderr(formatCatalogUsage());
    return 1;
  }

  const sourcePath = resolveCliPath(cli.cwd, args.filePath);
  const validation = validateCatalogOverrideFile(sourcePath);
  if (catalogIssuesHaveErrors(validation.issues)) {
    cli.stderr(formatCatalogValidationResult({
      overridePath: sourcePath,
      overrideFound: fs.existsSync(sourcePath),
      issues: validation.issues,
    }));
    return 1;
  }

  const destinationPath = args.overridePath
    ? resolveCliPath(cli.cwd, args.overridePath)
    : resolveCatalogOverridePath({ cwd: cli.cwd, env: cli.env });
  const sourceIsDestination = path.resolve(sourcePath) === path.resolve(destinationPath);
  if (fs.existsSync(destinationPath) && !args.force) {
    if (sourceIsDestination) {
      cli.stdout(
        args.json
          ? JSON.stringify(
              {
                imported: false,
                sourcePath,
                overridePath: destinationPath,
                alreadyActive: true,
                issues: validation.issues,
              },
              null,
              2,
            )
          : [
              "SiftGate catalog import",
              `Override: ${destinationPath}`,
              "Result: OK (override already active)",
            ].join("\n"),
      );
      return 0;
    }
    cli.stderr(
      `Catalog override already exists at ${destinationPath}. Use --force to replace it.`,
    );
    return 1;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);

  if (args.json) {
    cli.stdout(
      JSON.stringify(
        {
          imported: true,
          sourcePath,
          overridePath: destinationPath,
          issues: validation.issues,
        },
        null,
        2,
      ),
    );
  } else {
    cli.stdout(
      [
        "SiftGate catalog import",
        `Source: ${sourcePath}`,
        `Override: ${destinationPath}`,
        "",
        formatCatalogIssueGroup("Warnings", catalogIssuesBySeverity(validation.issues, "warning")),
        "",
        formatCatalogIssueGroup("Info", catalogIssuesBySeverity(validation.issues, "info")),
        "",
        "Result: OK",
      ].join("\n"),
    );
  }

  return 0;
}

async function runPluginCommand(args: string[], cli: CliIO): Promise<number> {
  let parsedArgs: PluginArgs;
  try {
    parsedArgs = parsePluginArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : "Invalid arguments.");
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
    if (parsedArgs.action === "install") {
      if (!parsedArgs.target) {
        throw new Error(
          "plugin install requires a local path or npm package name.",
        );
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

    if (parsedArgs.action === "list") {
      const result = manager.list();
      cli.stdout(
        parsedArgs.json
          ? JSON.stringify(result, null, 2)
          : formatPluginListResult(result.configPath, result.entries),
      );
      return 0;
    }

    if (!parsedArgs.target) {
      throw new Error(
        "plugin remove requires a plugin name, package, or path.",
      );
    }
    const result = manager.remove(parsedArgs.target);
    cli.stdout(
      parsedArgs.json
        ? JSON.stringify(result, null, 2)
        : formatPluginRemoveResult(result),
    );
    return 0;
  } catch (error) {
    cli.stderr(
      error instanceof Error ? error.message : "Plugin command failed.",
    );
    return 1;
  }
}

async function runMigrateCommand(args: string[], cli: CliIO): Promise<number> {
  let parsedArgs: MigrateArgs;
  try {
    parsedArgs = parseMigrateArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : "Invalid arguments.");
    cli.stderr(formatMigrateUsage());
    return 1;
  }

  if (parsedArgs.help) {
    cli.stdout(formatMigrateUsage());
    return 0;
  }

  const from = parsedArgs.from || (parsedArgs.to ? "siftgate" : undefined);
  const to = parsedArgs.to || "siftgate";
  if (!from) {
    cli.stderr("--from is required unless --to is used for SiftGate export.");
    cli.stderr(formatMigrateUsage());
    return 1;
  }
  if (!supportedMigrationType(from) || !supportedMigrationType(to)) {
    cli.stderr("Supported migration types are: litellm, newapi, oneapi, siftgate.");
    cli.stderr(formatMigrateUsage());
    return 1;
  }
  if (!parsedArgs.configPath) {
    cli.stderr("--config is required for migrate.");
    cli.stderr(formatMigrateUsage());
    return 1;
  }

  let result: ConfigMigrationResult;
  try {
    result = migrateConfigFile({
      from: from as MigrationConfigType,
      to: to as MigrationConfigType,
      configPath: parsedArgs.configPath,
      cwd: cli.cwd,
      outputPath: parsedArgs.outputPath,
      overwrite: parsedArgs.overwrite,
      force: parsedArgs.force,
      write: !parsedArgs.dryRun,
    });
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : "Migration failed.");
    return 1;
  }

  if (parsedArgs.json) {
    cli.stdout(JSON.stringify(toJsonMigrationResult(result), null, 2));
  } else {
    cli.stdout(formatConfigMigrationReport(result));
    if (parsedArgs.dryRun) {
      cli.stdout("");
      cli.stdout(result.yaml);
    }
  }

  return result.report.unsupported.length === 0 && result.report.incompatible.length === 0 ? 0 : 2;
}

async function runMigrateDbCommand(
  args: string[],
  cli: CliIO,
): Promise<number> {
  let parsedArgs: MigrateDbArgs;
  try {
    parsedArgs = parseMigrateDbArgs(args);
  } catch (error) {
    cli.stderr(error instanceof Error ? error.message : "Invalid arguments.");
    cli.stderr(formatMigrateDbUsage());
    return 1;
  }

  if (parsedArgs.help) {
    cli.stdout(formatMigrateDbUsage());
    return 0;
  }

  const from = parsedArgs.from ?? "sqlite";
  const to = parsedArgs.to ?? "postgres";
  if (from !== "sqlite" || to !== "postgres") {
    cli.stderr("Only --from sqlite --to postgres is supported.");
    cli.stderr(formatMigrateDbUsage());
    return 1;
  }

  const sqlitePath = parsedArgs.sqlitePath ?? "./data/gateway.db";
  const postgresUrl =
    parsedArgs.postgresUrl ?? cli.env.DATABASE_URL ?? cli.env.POSTGRES_URL;
  if (!postgresUrl) {
    cli.stderr(
      "--postgres-url is required unless DATABASE_URL or POSTGRES_URL is set.",
    );
    cli.stderr(formatMigrateDbUsage());
    return 1;
  }

  let result: DbMigrationResult;
  try {
    result = await migrateSqliteToPostgres({
      sqlitePath,
      postgresUrl,
      cwd: cli.cwd,
      dryRun: parsedArgs.dryRun,
      backup: parsedArgs.backup,
      backupPath: parsedArgs.backupPath,
      force: parsedArgs.force,
      batchSize: parsedArgs.batchSize,
      now: cli.now,
    });
  } catch (error) {
    cli.stderr(
      error instanceof Error ? error.message : "Database migration failed.",
    );
    return 1;
  }

  cli.stdout(
    parsedArgs.json
      ? JSON.stringify(result, null, 2)
      : formatDbMigrationReport(result),
  );

  return result.validation.ok ? 0 : 2;
}

function parseValidateArgs(args: string[]): ValidateArgs {
  const parsed: ValidateArgs = { json: false, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a path.`);
      }
      parsed.configPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        throw new Error("--config requires a path.");
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

  if (!action || action === "--help" || action === "-h") {
    parsed.help = action === "--help" || action === "-h";
    return parsed;
  }

  if (!["install", "list", "remove"].includes(action)) {
    throw new Error(`Unknown plugin command: ${action}`);
  }
  parsed.action = action as PluginArgs["action"];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--optional") {
      parsed.required = false;
      continue;
    }
    if (arg === "--required") {
      parsed.required = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--no-npm-install") {
      parsed.npmInstall = false;
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      const value = rest[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a path.`);
      }
      parsed.configPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        throw new Error("--config requires a path.");
      }
      parsed.configPath = value;
      continue;
    }
    if (!parsed.target && !arg.startsWith("-")) {
      parsed.target = arg;
      continue;
    }
    throw new Error(`Unknown plugin option: ${arg}`);
  }

  return parsed;
}

function parseCatalogArgs(args: string[]): CatalogArgs {
  const parsed: CatalogArgs = {
    force: false,
    json: false,
    help: false,
  };
  const [action, ...rest] = args;

  if (!action || action === "--help" || action === "-h") {
    parsed.help = action === "--help" || action === "-h";
    return parsed;
  }

  if (!["list", "show", "validate", "export", "import"].includes(action)) {
    throw new Error(`Unknown catalog command: ${action}`);
  }
  parsed.action = action as CatalogArgs["action"];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--file" || arg === "-f") {
      parsed.filePath = requireValue(rest, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--file=")) {
      parsed.filePath = requireInlineValue(arg, "--file");
      continue;
    }
    if (arg === "--override") {
      parsed.overridePath = requireValue(rest, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--override=")) {
      parsed.overridePath = requireInlineValue(arg, "--override");
      continue;
    }
    if (arg === "--out" || arg === "-o") {
      parsed.outputPath = requireValue(rest, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.outputPath = requireInlineValue(arg, "--out");
      continue;
    }
    if (!parsed.provider && parsed.action === "show" && !arg.startsWith("-")) {
      parsed.provider = arg;
      continue;
    }
    throw new Error(`Unknown catalog option: ${arg}`);
  }

  return parsed;
}

function parseMigrateArgs(args: string[]): MigrateArgs {
  const parsed: MigrateArgs = {
    overwrite: false,
    force: false,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--overwrite") {
      parsed.overwrite = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--from") {
      parsed.from = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = requireInlineValue(arg, "--from");
      continue;
    }
    if (arg === "--to") {
      parsed.to = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = requireInlineValue(arg, "--to");
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      parsed.configPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      parsed.configPath = requireInlineValue(arg, "--config");
      continue;
    }
    if (arg === "--out" || arg === "-o") {
      parsed.outputPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.outputPath = requireInlineValue(arg, "--out");
      continue;
    }
    throw new Error(`Unknown migrate option: ${arg}`);
  }

  return parsed;
}

function parseMigrateDbArgs(args: string[]): MigrateDbArgs {
  const parsed: MigrateDbArgs = {
    backup: false,
    force: false,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--backup") {
      parsed.backup = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--from") {
      parsed.from = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = requireInlineValue(arg, "--from");
      continue;
    }
    if (arg === "--to") {
      parsed.to = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = requireInlineValue(arg, "--to");
      continue;
    }
    if (arg === "--sqlite" || arg === "--sqlite-path") {
      parsed.sqlitePath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--sqlite=")) {
      parsed.sqlitePath = requireInlineValue(arg, "--sqlite");
      continue;
    }
    if (arg.startsWith("--sqlite-path=")) {
      parsed.sqlitePath = requireInlineValue(arg, "--sqlite-path");
      continue;
    }
    if (arg === "--postgres" || arg === "--postgres-url") {
      parsed.postgresUrl = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--postgres=")) {
      parsed.postgresUrl = requireInlineValue(arg, "--postgres");
      continue;
    }
    if (arg.startsWith("--postgres-url=")) {
      parsed.postgresUrl = requireInlineValue(arg, "--postgres-url");
      continue;
    }
    if (arg === "--backup-path") {
      parsed.backupPath = requireValue(args, index, arg);
      parsed.backup = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--backup-path=")) {
      parsed.backupPath = requireInlineValue(arg, "--backup-path");
      parsed.backup = true;
      continue;
    }
    if (arg === "--batch-size") {
      parsed.batchSize = parsePositiveInteger(
        requireValue(args, index, arg),
        arg,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      parsed.batchSize = parsePositiveInteger(
        requireInlineValue(arg, "--batch-size"),
        "--batch-size",
      );
      continue;
    }
    throw new Error(`Unknown migrate-db option: ${arg}`);
  }

  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
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

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export function formatValidationResult(result: ConfigValidationResult): string {
  const lines = [
    "SiftGate config validation",
    `Config: ${path.resolve(result.configPath)}`,
    "",
    formatIssueGroup("Errors", result.errors),
    "",
    formatIssueGroup("Warnings", result.warnings),
    "",
    formatIssueGroup("Info", result.info),
    "",
    result.ok ? "Result: OK" : "Result: FAILED",
  ];

  return lines.join("\n");
}

function formatIssueGroup(
  label: string,
  issues: Array<{ code: string; message: string; path?: string }>,
): string {
  if (issues.length === 0) {
    return `${label}: none`;
  }

  return [
    `${label} (${issues.length})`,
    ...issues.map((item) => `  - ${formatIssue(item)}`),
  ].join("\n");
}

function formatIssue(issue: { code: string; message: string; path?: string }): string {
  const location = issue.path ? `${issue.path}: ` : "";
  return `[${issue.code}] ${location}${issue.message}`;
}

function formatCatalogProviderList(
  catalog: ProviderCatalog,
  overridePath: string,
): string {
  return [
    "SiftGate provider catalog",
    `Override: ${overridePath}`,
    `Providers: ${catalog.providers.length}`,
    "",
    ...catalog.providers.map((provider) =>
      [
        `- ${provider.id}`,
        `name="${provider.name}"`,
        `models=${provider.models.length}`,
        `auth=${provider.auth_type}`,
        provider.overridden ? "overridden=true" : "overridden=false",
      ].join(" "),
    ),
  ].join("\n");
}

function formatCatalogProvider(
  provider: CatalogProvider,
  overridePath: string,
): string {
  const endpointSummary = Object.entries(provider.endpoints)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return [
    "SiftGate catalog provider",
    `Override: ${overridePath}`,
    `Provider: ${provider.id}`,
    `Name: ${provider.name}`,
    `Base URL: ${provider.base_url}`,
    `Auth: ${provider.auth_type}`,
    `Overridden: ${provider.overridden ? "yes" : "no"}`,
    `Endpoints: ${endpointSummary || "none"}`,
    `Capabilities: ${(provider.capabilities || []).join(", ") || "none"}`,
    "",
    "Models:",
    ...provider.models.map((model) =>
      [
        `  - ${model.id}`,
        `modalities=${model.modalities.join(",")}`,
        `capabilities=${model.capabilities.join(",") || "none"}`,
        model.overridden ? "overridden=true" : "overridden=false",
      ].join(" "),
    ),
  ].join("\n");
}

function formatCatalogValidationResult(input: {
  overridePath: string;
  overrideFound: boolean;
  issues: CatalogIssue[];
}): string {
  return [
    "SiftGate catalog validation",
    `Override: ${input.overridePath}`,
    `Override found: ${input.overrideFound ? "yes" : "no"}`,
    "",
    formatCatalogIssueGroup("Errors", catalogIssuesBySeverity(input.issues, "error")),
    "",
    formatCatalogIssueGroup("Warnings", catalogIssuesBySeverity(input.issues, "warning")),
    "",
    formatCatalogIssueGroup("Info", catalogIssuesBySeverity(input.issues, "info")),
    "",
    catalogIssuesHaveErrors(input.issues) ? "Result: FAILED" : "Result: OK",
  ].join("\n");
}

function formatCatalogIssueGroup(
  label: string,
  issues: CatalogIssue[],
): string {
  if (issues.length === 0) {
    return `${label}: none`;
  }
  return [
    `${label} (${issues.length})`,
    ...issues.map((item) => `  - ${formatIssue(item)}`),
  ].join("\n");
}

function catalogIssuesBySeverity(
  issues: CatalogIssue[],
  severity: CatalogIssue["severity"],
): CatalogIssue[] {
  return issues.filter((issue) => issue.severity === severity);
}

function catalogIssuesHaveErrors(issues: CatalogIssue[]): boolean {
  return catalogIssuesBySeverity(issues, "error").length > 0;
}

function resolveCliPath(cwd: string, requestedPath: string): string {
  return path.isAbsolute(requestedPath)
    ? requestedPath
    : path.resolve(cwd, requestedPath);
}

function formatPluginInstallResult(result: PluginInstallResult): string {
  const lines = [
    "SiftGate plugin install",
    `Config: ${result.configPath}`,
    `Plugin: ${entryLabel(result.entry)}`,
    `Source: ${result.entry.source || "unknown"}`,
    `Path: ${result.entry.path}`,
    `Version: ${result.entry.version || "unknown"}`,
    `Required: ${result.entry.required !== false ? "true" : "false"}`,
    `NPM installed: ${result.npmInstalled ? "yes" : "no"}`,
  ];
  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    lines.push(...result.warnings.map((warning) => `  - ${warning}`));
  }
  return lines.join("\n");
}

function formatPluginListResult(
  configPath: string,
  entries: ManagedPluginConfigEntry[],
): string {
  if (entries.length === 0) {
    return ["SiftGate plugins", `Config: ${configPath}`, "Plugins: none"].join(
      "\n",
    );
  }

  return [
    "SiftGate plugins",
    `Config: ${configPath}`,
    ...entries.map((entry) =>
      [
        `- ${entryLabel(entry)}`,
        `source=${entry.source || "unknown"}`,
        `path=${entry.path}`,
        `version=${entry.version || "unknown"}`,
        `required=${entry.required !== false ? "true" : "false"}`,
      ].join(" "),
    ),
  ].join("\n");
}

function formatPluginRemoveResult(result: PluginRemoveResult): string {
  return [
    "SiftGate plugin remove",
    `Config: ${result.configPath}`,
    ...result.removed.map((entry) => `Removed: ${entryLabel(entry)}`),
  ].join("\n");
}

function entryLabel(entry: ManagedPluginConfigEntry): string {
  return entry.name || entry.package || entry.path;
}

function toJsonResult(
  result: ConfigValidationResult,
): Omit<ConfigValidationResult, "config"> {
  return {
    configPath: result.configPath,
    ok: result.ok,
    issues: result.issues,
    errors: result.errors,
    warnings: result.warnings,
    info: result.info,
  };
}

function toJsonMigrationResult(result: ConfigMigrationResult): object {
  return {
    sourceType: result.sourceType,
    targetType: result.targetType,
    sourcePath: result.sourcePath,
    outputPath: result.outputPath,
    report: result.report,
    output: result.output,
    config: result.config,
  };
}

function formatUsage(): string {
  return [
    "Usage:",
    "  siftgate validate [--config gateway.config.yaml] [--json]",
    "  siftgate catalog list [--override catalog.override.yaml] [--json]",
    "  siftgate catalog show <provider> [--override catalog.override.yaml] [--json]",
    "  siftgate catalog validate [--file catalog.override.yaml] [--json]",
    "  siftgate catalog export [--override catalog.override.yaml] [--out catalog.yaml]",
    "  siftgate catalog import --file catalog.override.yaml [--override catalog.override.yaml] [--force]",
    `  siftgate plugin install <path|@siftgate/plugin-name> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    `  siftgate plugin list [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    `  siftgate plugin remove <name|package|path> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    "  siftgate migrate --from litellm|newapi|oneapi --config source.yaml [--out gateway.config.yaml]",
    "  siftgate migrate --to litellm|newapi|oneapi --config gateway.config.yaml [--out target.generated.yaml]",
    "  siftgate migrate-db --from sqlite --to postgres [--sqlite-path ./data/gateway.db] [--postgres-url postgresql://...]",
    "",
    "Commands:",
    "  validate   Validate a SiftGate gateway.config.yaml file",
    "  catalog    Inspect, validate, export, and import provider/model catalog overrides",
    "  plugin     Manage plugin declarations and npm/local installs",
    "  migrate    Migrate third-party gateway configs into SiftGate format",
    "  migrate-db Move local SQLite runtime data into PostgreSQL",
  ].join("\n");
}

function formatCatalogUsage(): string {
  return [
    "Usage:",
    "  siftgate catalog list [--override catalog.override.yaml] [--json]",
    "  siftgate catalog show <provider> [--override catalog.override.yaml] [--json]",
    "  siftgate catalog validate [--file catalog.override.yaml] [--override catalog.override.yaml] [--json]",
    "  siftgate catalog export [--override catalog.override.yaml] [--out catalog.yaml] [--json]",
    "  siftgate catalog import --file catalog.override.yaml [--override catalog.override.yaml] [--force] [--json]",
    "",
    "Options:",
    "      --override <path>  Local override destination/source path (default: catalog.override.yaml)",
    "  -f, --file <path>      Override file to validate or import",
    "  -o, --out <path>       Write exported merged catalog to a file",
    "      --force            Replace an existing override during import",
    "      --json             Print machine-readable JSON",
    "  -h, --help             Show help",
  ].join("\n");
}

function formatValidateUsage(): string {
  return [
    "Usage:",
    "  siftgate validate [--config gateway.config.yaml] [--json]",
    "",
    "Options:",
    "  -c, --config <path>   Config file to validate",
    "      --json            Print machine-readable JSON",
    "  -h, --help            Show help",
  ].join("\n");
}

function formatPluginUsage(): string {
  return [
    "Usage:",
    `  siftgate plugin install <path|@siftgate/plugin-name> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    `  siftgate plugin list [--config ${DEFAULT_PLUGINS_CONFIG}] [--json]`,
    `  siftgate plugin remove <name|package|path> [--config ${DEFAULT_PLUGINS_CONFIG}]`,
    "",
    "Options:",
    `  -c, --config <path>   Plugin declaration file (default: ${DEFAULT_PLUGINS_CONFIG})`,
    "      --json            Print machine-readable JSON",
    "      --optional        Mark plugin as optional at gateway startup",
    "      --required        Mark plugin as required at gateway startup",
    "      --force           Replace an existing declaration for the same plugin",
    "      --no-npm-install  Only write the declaration for npm packages",
    "  -h, --help            Show help",
  ].join("\n");
}

function formatMigrateUsage(): string {
  return [
    "Usage:",
    "  siftgate migrate --from litellm|newapi|oneapi --config source.yaml [--out gateway.config.yaml]",
    "  siftgate migrate --from siftgate --to litellm|newapi|oneapi --config gateway.config.yaml [--out target.generated.yaml]",
    "  siftgate migrate --to litellm|newapi|oneapi --config gateway.config.yaml [--out target.generated.yaml]",
    "",
    "Options:",
    '      --from <source>    Source type: "litellm", "newapi", "oneapi", or "siftgate"',
    '      --to <target>      Target type: "siftgate", "litellm", "newapi", or "oneapi"',
    "  -c, --config <path>   Source config file to migrate",
    "  -o, --out <path>      Output path (default depends on target)",
    "      --force           Allow overwriting the output file",
    "      --overwrite       Backward-compatible alias for --force",
    "      --dry-run         Print generated YAML instead of writing it",
    "      --json            Print machine-readable migration report",
    "  -h, --help            Show help",
  ].join("\n");
}

function formatMigrateDbUsage(): string {
  return [
    "Usage:",
    "  siftgate migrate-db --from sqlite --to postgres [--sqlite-path ./data/gateway.db] [--postgres-url postgresql://...]",
    "",
    "Options:",
    '      --from <source>       Source database. Currently only "sqlite"',
    '      --to <target>         Target database. Currently only "postgres"',
    "      --sqlite-path <path>  SQLite database path (default: ./data/gateway.db)",
    "      --sqlite <path>       Alias for --sqlite-path",
    "      --postgres-url <url>  PostgreSQL connection URL (or DATABASE_URL / POSTGRES_URL)",
    "      --postgres <url>      Alias for --postgres-url",
    "      --backup             Copy the SQLite file before importing",
    "      --backup-path <path>  Backup destination; implies --backup",
    "      --force              Allow importing into non-empty target tables",
    "      --dry-run            Inspect SQLite and validate arguments without writing PostgreSQL",
    "      --batch-size <n>      Rows per TypeORM save chunk (default: 500)",
    "      --json               Print machine-readable migration report",
    "  -h, --help               Show help",
  ].join("\n");
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
