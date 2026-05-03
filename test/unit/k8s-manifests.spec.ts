import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const root = path.resolve(__dirname, '../..');

describe('Kubernetes and Helm deployment manifests', () => {
  it('passes the deployment manifest validator', () => {
    expect(() => {
      execFileSync('node', ['scripts/validate-k8s-manifests.js'], {
        cwd: root,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('keeps default Helm values single-instance and optional-backend friendly', () => {
    const values = yaml.load(
      fs.readFileSync(path.join(root, 'deploy/helm/siftgate/values.yaml'), 'utf8'),
    ) as any;
    const config = yaml.load(values.config.data) as any;

    expect(values.replicaCount).toBe(1);
    expect(values.postgres.enabled).toBe(false);
    expect(values.redis.enabled).toBe(false);
    expect(config.database.type).toBe('sqlite');
    expect(config.state.backend).toBe('memory');
    expect(config.cluster.enabled).toBe(false);
    expect(config.dashboard.password).toBe('${DASHBOARD_PASSWORD_HASH:-}');
  });
});
