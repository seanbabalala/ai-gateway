import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

function execFileAsync(
  command: string,
  args: string[],
  options: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

describe('benchmark-platform script', () => {
  jest.setTimeout(90_000);

  it('runs the deterministic local benchmark and writes JSON/Markdown reports', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-platform-bench-'));
    const output = path.join(dir, 'platform-report.json');
    const markdownOutput = path.join(dir, 'platform-report.md');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SIFTGATE_BENCH_REQUESTS: '1',
      SIFTGATE_BENCH_CONCURRENCY: '1',
      SIFTGATE_BENCH_OUTPUT: output,
      SIFTGATE_BENCH_MARKDOWN_OUTPUT: markdownOutput,
    };
    delete env.GATEWAY_CONFIG_PATH;
    delete env.SIFTGATE_BENCH_POSTGRES_URL;
    delete env.SIFTGATE_BENCH_REDIS_URL;
    delete env.SIFTGATE_BENCH_REAL_UPSTREAM_URL;
    delete env.SIFTGATE_BENCH_REAL_UPSTREAM_API_KEY;

    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/benchmark-platform.js'],
      { cwd: process.cwd(), env },
    );

    const fromStdout = JSON.parse(stdout);
    const fromFile = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(fromStdout).toEqual(fromFile);
    expect(fromFile).toMatchObject({
      report_schema: 'siftgate.platform_benchmark.v1',
      release: 'v2.7.1',
      rc_measurement: false,
      methodology: {
        script: 'npm run benchmark:platform',
        deterministic_mode: true,
        provider_dependency: 'none',
      },
      privacy: {
        prompt_response_stored: false,
        raw_headers_stored: false,
        provider_keys_exposed: false,
        media_bytes_stored: false,
        metadata_only: true,
      },
    });

    const scenarios = new Map(
      fromFile.scenarios.map((scenario: { name: string; status: string }) => [
        scenario.name,
        scenario.status,
      ]),
    );
    expect(scenarios.get('upstream_mock_baseline')).toBe('measured');
    expect(scenarios.get('chat_proxy_direct_sqlite')).toBe('measured');
    expect(scenarios.get('chat_smart_routing_sqlite')).toBe('measured');
    expect(scenarios.get('streaming_chat_sqlite')).toBe('measured');
    expect(scenarios.get('dashboard_log_write_sqlite')).toBe('measured');
    expect(scenarios.get('dashboard_log_read_sqlite')).toBe('measured');
    expect(scenarios.get('postgres_production_chat_proxy')).toBe('skipped');
    expect(scenarios.get('redis_cluster_chat_proxy')).toBe('skipped');
    expect(fromFile.comparisons.length).toBeGreaterThan(0);

    const markdown = fs.readFileSync(markdownOutput, 'utf8');
    expect(markdown).toContain('SiftGate v2.7.1 Performance Report');
    expect(markdown).toContain('GA measurements');
  });
});
