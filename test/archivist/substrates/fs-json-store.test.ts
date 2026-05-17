// charter: substrate-seam
// ADR-0181 task #99 commit 1 — `getByKey` + `list` unit tests for the
// production `makeFsJsonSubstrate` factory.
//
// The factory returns a branded `SubstrateAccess` that ALSO carries the read-
// only surface (`ReadCapableSubstrate` per types.ts:81). We narrow back to the
// read-only shape and exercise the two new methods directly — no handler
// wrapper, no audit ceremony. The factory writes a real JSON file to disk via
// its tmp+fsync+rename durability stack; tests use a per-test tmpdir to keep
// the existing primitive's locking + atomicity behavior in the loop.
//
// Record shape: the FS-JSON `getByKey` / `list` impl scans `documentRecords`
// (array elements OR top-level object values) and matches the `namespace` /
// `key` fields off each record. The test docs are the array-of-records form
// — the simplest representation that exercises both ops without the wrapping-
// object indirection.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeFsJsonSubstrate } from '../../../src/archivist/substrates/fs-json-store.js';
import type {
  ReadCapableSubstrate,
  StoreId,
  SubstrateAccess,
} from '../../../src/archivist/types.js';

// Test record shape — mirrors what the cli's `MemoryRecord` looks like at the
// fields the substrate matches on (namespace + key). Extra fields ride through
// untouched; the substrate is agnostic to the record's full schema.
interface TestRecord {
  readonly id: string;
  readonly namespace: string;
  readonly key: string;
  readonly content: string;
}

// Cast helper — the factory returns a branded SubstrateAccess; the runtime
// handle implements ReadCapableSubstrate (per types.ts:81 doc-block "Each
// factory implements every member"). The substrate-internal brand is type-
// level only, so this is the same pattern `routingReadOnlySubstrate` uses
// (index.ts:709).
function asReadable(access: SubstrateAccess): ReadCapableSubstrate {
  return access as unknown as ReadCapableSubstrate;
}

const STORE_ID = 'memory_search_index' as StoreId;

describe('makeFsJsonSubstrate — getByKey + list (ADR-0181 task #99 commit 1)', () => {
  let tmpDir: string;
  let path: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fs-json-substrate-test-'));
    path = join(tmpDir, 'store.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedRecords(records: ReadonlyArray<TestRecord>): void {
    writeFileSync(path, JSON.stringify(records, null, 2), 'utf-8');
  }

  describe('getByKey', () => {
    it('returns the matching record when (namespace, key) hits', async () => {
      seedRecords([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-2', key: 'k-1', content: 'v3' },
      ]);

      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const result = await asReadable(access).getByKey<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        key: 'k-2',
      });

      expect(result).toEqual({ id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' });
    });

    it('returns undefined when only namespace matches', async () => {
      seedRecords([{ id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' }]);
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const result = await asReadable(access).getByKey<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        key: 'k-missing',
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when only key matches', async () => {
      seedRecords([{ id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' }]);
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const result = await asReadable(access).getByKey<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-different',
        key: 'k-1',
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined on a missing file (no defaults)', async () => {
      // No seedRecords — file does not exist.
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const result = await asReadable(access).getByKey<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        key: 'k-1',
      });
      expect(result).toBeUndefined();
    });

    it('also matches on object-valued documents (namespace/key on top-level values)', async () => {
      // FS-JSON `documentRecords` accepts Object.values(doc) too — exercises
      // the `Record<id, record>` shape mentioned in the substrate doc-block.
      writeFileSync(
        path,
        JSON.stringify(
          {
            'rec-a': { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
            'rec-b': { id: 'b', namespace: 'ns-2', key: 'k-1', content: 'v2' },
          },
          null,
          2,
        ),
        'utf-8',
      );
      const access = makeFsJsonSubstrate<Record<string, TestRecord>>({ path });
      const result = await asReadable(access).getByKey<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-2',
        key: 'k-1',
      });
      expect(result?.id).toBe('b');
    });
  });

  describe('list', () => {
    it('without filters returns every record', async () => {
      seedRecords([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-2', key: 'k-1', content: 'v3' },
      ]);
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const results = await asReadable(access).list<TestRecord>({ storeId: STORE_ID });
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    });

    it('namespace filter keeps only matching records', async () => {
      seedRecords([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-2', key: 'k-1', content: 'v3' },
      ]);
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const results = await asReadable(access).list<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-1',
      });
      expect(results.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('offset + limit page after the namespace filter', async () => {
      seedRecords([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
        { id: 'c', namespace: 'ns-1', key: 'k-3', content: 'v3' },
        { id: 'd', namespace: 'ns-1', key: 'k-4', content: 'v4' },
        { id: 'e', namespace: 'ns-2', key: 'k-5', content: 'v5' },
      ]);
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const results = await asReadable(access).list<TestRecord>({
        storeId: STORE_ID,
        namespace: 'ns-1',
        offset: 1,
        limit: 2,
      });
      expect(results.map((r) => r.id)).toEqual(['b', 'c']);
    });

    it('limit larger than available rows returns the full remainder', async () => {
      seedRecords([
        { id: 'a', namespace: 'ns-1', key: 'k-1', content: 'v1' },
        { id: 'b', namespace: 'ns-1', key: 'k-2', content: 'v2' },
      ]);
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const results = await asReadable(access).list<TestRecord>({
        storeId: STORE_ID,
        limit: 100,
      });
      expect(results).toHaveLength(2);
    });

    it('returns empty array on missing file', async () => {
      const access = makeFsJsonSubstrate<ReadonlyArray<TestRecord>>({ path });
      const results = await asReadable(access).list<TestRecord>({ storeId: STORE_ID });
      expect(results).toEqual([]);
    });
  });
});
