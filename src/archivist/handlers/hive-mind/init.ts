// charter: dispatch
// hive-mind_init mutation handler (ADR-0181 Phase 5 → Phase 6 carry-forward
// brought-forward).
//
// The cli's `hive-mind_init` MCP tool builds the full HiveStateDoc and
// historically wrote it to `<projectRoot>/.claude-flow/hive-mind/state.json`
// directly via `saveHiveState()`. Phase 5 flipped `hive-mind_spawn` to
// dispatch through the archivist — whose FS-JSON substrate addresses the
// hive doc via `{key: 'root'}` (the substrate-wrapping convention shared
// with every other handler in this family). The cli's flat-file write
// therefore left `state.root === undefined`, and the very first
// `hive-mind_spawn` dispatch after init threw `not initialized` even
// though the file on disk WAS initialised — it just lived under the wrong
// document key.
//
// This handler closes that gap. The cli now dispatches `hive-mind_init`
// AFTER its existing local mutations so the SAME state lands at
// `{key: 'root'}` in the same on-disk file. Two writes, one file, same
// final shape — the file just gains the wrapping convention every
// archivist-dispatched read of this store assumes.
//
// Per `feedback-no-fallbacks`: the cli MUST dispatch this handler. There
// is no try/catch around the dispatch call site, no quiet fallback to
// "init didn't reach substrate".

import { registerMutationHandler } from '../../registration.js';
import type {
  GuardedWrite,
  MutationContext,
  StoreId,
} from '../../index.js';
import type { HiveStateDoc } from './hive-state.js';
import { initInvariants } from '../../invariants/hive-mind/init.js';

/** Payload — the full HiveStateDoc the cli composed under `withHiveStoreLock`.
 *  Carrying the entire doc keeps the handler stateless: it owns no defaults,
 *  no field-derivation logic — the cli already owns those. The handler's
 *  sole responsibility is to land the doc under the substrate's `'root'`
 *  key so subsequent archivist-dispatched reads see it. */
export interface HiveMindInitPayload {
  readonly state: HiveStateDoc;
}

const HIVE_STORE_ID = 'hive-mind_spawn' as StoreId;

export const initHiveMindHandler: GuardedWrite<HiveMindInitPayload> =
  registerMutationHandler<HiveMindInitPayload>(
    'hive-mind_init',
    async (ctx: MutationContext<false>, payload: HiveMindInitPayload): Promise<void> => {
      if (!payload || typeof payload !== 'object' || !payload.state) {
        throw new Error('hive-mind_init: payload.state is required (the composed HiveStateDoc)');
      }
      if (typeof payload.state !== 'object') {
        throw new Error('hive-mind_init: payload.state must be an object');
      }
      if (payload.state.initialized !== true) {
        throw new Error(
          'hive-mind_init: payload.state.initialized must be true — the cli init handler ' +
          'composes the full doc with initialized=true; surfacing this guard catches a ' +
          'malformed cli dispatch site rather than letting an incomplete state slip in.',
        );
      }

      await ctx.substrate.withWrite({ storeId: HIVE_STORE_ID }, async (handle) => {
        await handle.write({
          storeId: HIVE_STORE_ID,
          key: 'root',
          payload: payload.state,
        });
      });
    },
    {
      invariants: initInvariants,
      cacheScope: 'global',
    },
  );
