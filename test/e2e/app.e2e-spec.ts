/**
 * E2E smoke test — verifies the app boots successfully.
 * Detailed endpoint tests live in dedicated files.
 */

import { createE2EHarness, E2EHarness } from './setup';

describe('App (e2e)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await createE2EHarness();
  }, 30_000);

  afterAll(async () => {
    await harness?.close();
  });

  it('should boot the application successfully', () => {
    expect(harness.app).toBeDefined();
  });
});
