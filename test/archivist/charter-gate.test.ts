// charter: dispatch
// Sentinel for ADR-0180 §Governance: spawns the charter-conformance script and
// asserts exit 0. If this fails, every .ts file under src/archivist/** must
// carry a `// charter: <name>` tag whose name appears in MODULE.md's
// ```charter-responsibilities``` block.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const SCRIPT = path.resolve(
  __dirname,
  '../../../../ruflo-patch/scripts/check-archivist-charter.sh',
);

describe('archivist charter gate', () => {
  it('script is present and executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    const stat = fs.statSync(SCRIPT);
    expect(stat.mode & 0o111).not.toBe(0);
  });

  it('every src/archivist/**/*.ts file carries a valid `// charter:` tag', () => {
    const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8' });
    if (result.status !== 0) {
      const detail = `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
      throw new Error(`charter check failed (exit ${result.status})\n${detail}`);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\[charter-check\] OK:/);
  });
});
