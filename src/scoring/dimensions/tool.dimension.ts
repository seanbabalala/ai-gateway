// ===================================================================
// Tool Dimension — toolCount
// ===================================================================
// Measures the number of tools defined in the request.
// More tools generally indicate a more complex agentic task.
// ===================================================================

import { CanonicalRequest } from '../../canonical/canonical.types';

/**
 * toolCount — Number of tools in the request.
 * Range: [0, 1]
 *
 * 0 tools → 0
 * 1-2 tools → 0.3
 * 3-5 tools → 0.5
 * 6-10 tools → 0.7
 * 10+ tools → 1.0
 */
export function scoreToolCount(req: CanonicalRequest): number {
  const count = req.tools?.length || 0;

  if (count === 0) return 0;
  if (count <= 2) return 0.3;
  if (count <= 5) return 0.5;
  if (count <= 10) return 0.7;
  return 1.0;
}
