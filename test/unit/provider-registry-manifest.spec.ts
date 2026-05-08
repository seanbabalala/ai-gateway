import { execFile } from 'child_process';
import * as path from 'path';

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

describe('provider registry manifest validation', () => {
  it('accepts a review-required community provider manifest fixture', async () => {
    const fixture = path.resolve(
      __dirname,
      '../fixtures/catalog/provider-registry.valid.yaml',
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/validate-provider-registry.js', fixture],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain('Provider registry manifest validated');
  });
});
