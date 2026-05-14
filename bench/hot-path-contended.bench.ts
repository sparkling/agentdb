/**
 * W3 contended — Cross-process hot-path contention bench (ADR-0180 #13, #15).
 *
 * Per Follow-up #13 cross-process variant disposition (line 577): measures
 * the hot-path handler's p99 latency while sibling processes contend for the
 * `archivist-audit.jsonl` advisory write-lock. The full variant in #13
 * disposition asks for a REAL multi-process workload driven by
 * `npm run release` spawning workers (cli + daemon + Edit storm). This bench
 * file establishes the IN-PROCESS measurement shape; the cross-process
 * fan-out is harness-level — `npm run release` is expected to fork
 * additional writers when wiring the gate in Phase 7.
 *
 * Per Follow-up #15 (multi-process audit semantics): all contenders write
 * through a single shared append-only `archivist-audit.jsonl` with
 * fcntl/flock advisory locking. The single-fd-per-process invariant means
 * each writer process owns exactly one fd. The contention this bench
 * measures is cross-process, not intra-process.
 *
 * Assertions (per #13 disposition lines 559-577):
 *   solo p99      <  2 ms  — single-process baseline (W3 unchanged)
 *   contended p99 <= 5 ms  — relaxed under cross-process pressure
 *
 * Captures (per #13 line 577):
 *   - lock-acquisition wait histogram (proxy: per-write latency buckets)
 *   - fsync-batch-coalesce ratio (parent self-report)
 *
 * Env knobs:
 *   WRITER_PROCS=N   (default 2) — number of sibling Node writers to fork.
 *                    N >= 2 ⇒ contended phase runs. N <= 1 ⇒ contended phase
 *                    skipped (solo baseline only; useful for quick local
 *                    runs without the IPC fan-out cost).
 *   IS_WORKER=1      — internal: marks a forked child writer process.
 *
 * Stubbed per Phase 2 W3 pattern: the hot-path write below is an
 * appendFileSync into the shared journal — TODO(F4-2) replace with the
 * archivist `registerMutationHandler('hot.*', ..., { hotPath: true })`
 * dispatch once Phase 7 wires it. The bench file establishes SHAPE +
 * cross-process contention envelope; absolute numbers update when the
 * archivist hot-path lands.
 *
 * Runner: `tsx --test bench/hot-path-contended.bench.ts`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SOLO_ITERATIONS = 2_000;
const CONTENDED_ITERATIONS = 5_000;
const WRITER_PROCS = Math.max(0, Number(process.env.WRITER_PROCS ?? '2'));
const SOLO_P99_MAX_US = 2_000;
const CONTENDED_P99_MAX_US = 5_000;

const __filename = fileURLToPath(import.meta.url);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(samplesUs: number[]) {
  const sorted = [...samplesUs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    p999: percentile(sorted, 99.9),
    count: sorted.length,
  };
}

function lockWaitHistogram(samplesUs: number[]) {
  const buckets = [100, 250, 500, 1_000, 2_000, 5_000, 10_000];
  const counts = new Array(buckets.length + 1).fill(0);
  for (const s of samplesUs) {
    let placed = false;
    for (let i = 0; i < buckets.length; i++) {
      if (s < buckets[i]) {
        counts[i]++;
        placed = true;
        break;
      }
    }
    if (!placed) counts[buckets.length]++;
  }
  const labels = buckets.map((b, i) => {
    const lo = i === 0 ? 0 : buckets[i - 1];
    return `${lo}-${b}us`;
  });
  labels.push(`>=${buckets[buckets.length - 1]}us`);
  return Object.fromEntries(labels.map((l, i) => [l, counts[i]]));
}

// TODO(F4-2): replace with real archivist hot-path registration:
//   registerMutationHandler('hot.*', handler, { hotPath: true })
// For Phase 2 / Phase 7 wiring, the stub mirrors `hot-path.bench.ts` —
// appendFileSync into a shared journal so the kernel append-mode
// serialization stands in for the future fcntl/flock advisory lock.
function hotPathWriteStub(journalPath: string, payload: string): void {
  appendFileSync(journalPath, payload + '\n');
}

// Child writer entrypoint — runs when this file is fork()'d with IS_WORKER=1.
// Hammers the shared journal until the parent signals stop via IPC.
function runWorker(): void {
  const journalPath = process.env.SHARED_JOURNAL_PATH;
  if (!journalPath) {
    console.error('[worker] SHARED_JOURNAL_PATH not set');
    process.exit(1);
  }

  let stop = false;
  let seq = 0;

  process.on('message', (msg: { stop?: boolean; go?: boolean }) => {
    if (msg?.stop) stop = true;
  });

  process.send?.({ ready: true });

  const onGo = (msg: { go?: boolean }) => {
    if (!msg?.go) return;
    process.off('message', onGo);

    const drive = () => {
      const batchEnd = seq + 64;
      while (!stop && seq < batchEnd) {
        hotPathWriteStub(
          journalPath,
          `{"src":${process.pid},"seq":${seq++}}`,
        );
      }
      if (stop) {
        process.send?.({ done: true, written: seq });
        setTimeout(() => process.exit(0), 50);
      } else {
        setImmediate(drive);
      }
    };
    drive();
  };
  process.on('message', onGo);
}

if (process.env.IS_WORKER === '1') {
  runWorker();
} else {
  test('W3 contended — solo p99 < 2ms + contended p99 <= 5ms (ADR-0180 #13, #15)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'w3-contended-'));
    const journalPath = join(dir, 'archivist-audit.jsonl');
    writeFileSync(journalPath, '');

    try {
      // -------- Phase A: solo baseline --------
      // Discarded warmup
      for (let i = 0; i < 200; i++) {
        hotPathWriteStub(journalPath, `{"warmup":${i}}`);
      }

      const soloSamples: number[] = new Array(SOLO_ITERATIONS);
      for (let i = 0; i < SOLO_ITERATIONS; i++) {
        const payload = `{"src":${process.pid},"solo":${i}}`;
        const t0 = performance.now();
        hotPathWriteStub(journalPath, payload);
        soloSamples[i] = (performance.now() - t0) * 1000;
      }
      const solo = summarize(soloSamples);

      console.log(`[W3-contended] solo us p50=${solo.p50.toFixed(2)} p99=${solo.p99.toFixed(2)} p999=${solo.p999.toFixed(2)}`);

      assert.ok(
        solo.p99 < SOLO_P99_MAX_US,
        `W3-solo p99 ceiling: ${solo.p99.toFixed(2)}us ≥ ${SOLO_P99_MAX_US}us — single-process regression independent of contention`,
      );

      // -------- Phase B: contended --------
      if (WRITER_PROCS < 2) {
        console.log(`[W3-contended] WRITER_PROCS=${WRITER_PROCS} < 2; contended phase skipped`);
        return;
      }

      const workers = await Promise.all(
        Array.from({ length: WRITER_PROCS - 1 }, () =>
          spawnWorker(__filename, journalPath),
        ),
      );

      // All workers ready; release them simultaneously.
      for (const w of workers) w.child.send({ go: true });

      const contendedSamples: number[] = new Array(CONTENDED_ITERATIONS);
      let parentWrites = 0;
      for (let i = 0; i < CONTENDED_ITERATIONS; i++) {
        const payload = `{"src":${process.pid},"contended":${i}}`;
        const t0 = performance.now();
        hotPathWriteStub(journalPath, payload);
        contendedSamples[i] = (performance.now() - t0) * 1000;
        parentWrites++;
      }

      const workerCounts = await Promise.all(
        workers.map(async (w) => {
          w.child.send({ stop: true });
          return await w.done;
        }),
      );

      const contended = summarize(contendedSamples);
      const lockHistogram = lockWaitHistogram(contendedSamples);
      const totalWorkerWrites = workerCounts.reduce(
        (sum, c) => sum + (c?.written ?? 0),
        0,
      );

      console.log(`[W3-contended] contended us p50=${contended.p50.toFixed(2)} p99=${contended.p99.toFixed(2)} p999=${contended.p999.toFixed(2)} (writers=${WRITER_PROCS})`);
      console.log('[W3-contended] lock-wait histogram:', lockHistogram);
      // fsync-batch-coalesce ratio (parent self-report): the stub uses
      // appendFileSync, so the kernel does the coalescing at the page-cache
      // layer rather than a userspace 100ms timer. The ratio reported here
      // is the trivial 1:1 (one append per write); it'll become meaningful
      // once the real archivist hot-path lands with batched fsync.
      console.log(`[W3-contended] coalesce ratio (parent): writes=${parentWrites} fsync=stub-noop`);
      console.log(`[W3-contended] worker writes: ${workerCounts.map((c, i) => `w${i}=${c?.written ?? '?'}`).join(' ')} total=${totalWorkerWrites}`);

      assert.ok(
        contended.p99 <= CONTENDED_P99_MAX_US,
        `W3-contended p99 ceiling: ${contended.p99.toFixed(2)}us > ${CONTENDED_P99_MAX_US}us — lock contention exceeds budget; investigate the fcntl/flock primitive (audit-writer.ts acquireWriteLock — see Follow-up #15 disposition) or renegotiate via ADR amendment`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

interface SpawnedWorker {
  child: ReturnType<typeof fork>;
  done: Promise<{ written: number } | undefined>;
}

function spawnWorker(scriptPath: string, journalPath: string): Promise<SpawnedWorker> {
  return new Promise((resolve, reject) => {
    const child = fork(scriptPath, [], {
      env: {
        ...process.env,
        IS_WORKER: '1',
        SHARED_JOURNAL_PATH: journalPath,
      },
      execArgv: process.execArgv, // inherit tsx loader if present
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    let writtenCount: number | undefined;
    const done = new Promise<{ written: number } | undefined>((res, rej) => {
      child.on('message', (msg: { done?: boolean; written?: number }) => {
        if (msg?.done) writtenCount = msg.written;
      });
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          rej(new Error(`worker exited with code ${code}`));
          return;
        }
        res(writtenCount !== undefined ? { written: writtenCount } : undefined);
      });
      child.on('error', rej);
    });

    const onReady = (msg: { ready?: boolean }) => {
      if (msg?.ready) {
        child.off('message', onReady);
        resolve({ child, done });
      }
    };
    child.on('message', onReady);
    child.on('error', reject);
  });
}
