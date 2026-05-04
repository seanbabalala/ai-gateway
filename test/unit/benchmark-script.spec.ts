import * as http from 'http';
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

describe('benchmark-upstream script', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('method not allowed');
        return;
      }
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server address');
    url = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('writes a JSON report when GATEWAY_BENCH_OUTPUT is set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siftgate-bench-'));
    const output = path.join(dir, 'report.json');
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/benchmark-upstream.js'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GATEWAY_BENCH_URL: url,
          GATEWAY_BENCH_NO_AUTH: '1',
          GATEWAY_BENCH_REQUESTS: '3',
          GATEWAY_BENCH_CONCURRENCY: '2',
          GATEWAY_BENCH_OUTPUT: output,
          GATEWAY_BENCH_LABEL: 'unit-test',
        },
      },
    );

    const fromStdout = JSON.parse(stdout);
    const fromFile = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(fromFile).toMatchObject({
      label: 'unit-test',
      success: 3,
      failed: 0,
      target: {
        url,
        requests: 3,
        concurrency: 2,
      },
    });
    expect(fromFile.latency_ms).toHaveProperty('p75');
    expect(fromFile.methodology.script).toBe('npm run benchmark:upstream');
    expect(fromStdout).toEqual(fromFile);
  });
});
