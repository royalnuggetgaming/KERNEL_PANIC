/**
 * Shortest valid FSM route for the dev API's goto(): a breadth-first search over whole stacks using the frozen
 * EDGES table (guards included), so pops only go back to the state really below and the Hangar/midrun shop
 * payloads are chosen by context. Pure: no DOM, no services.
 */
import type { RunOutcome } from '../contracts/ids';
import type { Edge, StateId } from '../contracts/states';
import { EDGES, MAX_STACK_DEPTH } from '../engine/transitions';

export type Hop =
  | { readonly op: 'pop'; readonly to: StateId }
  | { readonly op: 'replace' | 'push'; readonly to: StateId; readonly payload: HopPayload };

/** Payload descriptor; the host turns 'config' into a real RunConfig. */
export type HopPayload =
  | { readonly kind: 'none' }
  | { readonly kind: 'select' }
  | { readonly kind: 'config' }
  | { readonly kind: 'shop'; readonly mode: 'meta' | 'midrun' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'gameOver'; readonly outcome: RunOutcome };

/** Guard-checkable stand-in payload for an edge (configs only need to be objects). */
function payloadFor(e: Edge): { readonly hop: HopPayload; readonly probe: unknown }[] {
  switch (e.to) {
    case 'MainMenu':
    case 'Boot':
      return [{ hop: { kind: 'none' }, probe: undefined }];
    case 'CharacterSelect':
      return [{ hop: { kind: 'select' }, probe: { prefill: null, mode: null } }];
    case 'Playing':
      return [{ hop: { kind: 'config' }, probe: { config: {} } }];
    case 'UpgradesShop':
      return [
        { hop: { kind: 'shop', mode: 'meta' }, probe: { mode: 'meta' } },
        { hop: { kind: 'shop', mode: 'midrun' }, probe: { mode: 'midrun' } },
      ];
    case 'Paused':
      return [{ hop: { kind: 'pause' }, probe: { reason: 'user' } }];
    case 'GameOver': {
      const outcomes: readonly RunOutcome[] = ['abandoned', 'defeat', 'victory'];
      return outcomes.map((outcome) => ({ hop: { kind: 'gameOver', outcome }, probe: { outcome } }));
    }
  }
}

interface Node {
  readonly stack: readonly StateId[];
  readonly first: Hop | null;
}

function key(stack: readonly StateId[]): string {
  return stack.join('>');
}

/** First hop of the shortest route from `stack` to a stack whose top is `target`; null when unreachable. */
export function firstHopToward(stack: readonly StateId[], target: StateId): Hop | null {
  if (stack[stack.length - 1] === target) return null;
  const seen = new Set<string>([key(stack)]);
  let frontier: Node[] = [{ stack, first: null }];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      const top = node.stack[node.stack.length - 1]!;
      for (const e of EDGES as readonly Edge[]) {
        if (e.from !== top) continue;
        const options: { readonly hop: Hop; readonly probe: unknown }[] =
          e.op === 'pop'
            ? [{ hop: { op: 'pop', to: e.to }, probe: undefined }]
            : payloadFor(e).map((p) => ({
                hop: { op: e.op === 'push' ? 'push' : 'replace', to: e.to, payload: p.hop },
                probe: p.probe,
              }));
        for (const o of options) {
          if (e.guard !== undefined && !e.guard(o.probe, node.stack)) continue;
          let after: readonly StateId[];
          if (e.op === 'replace') after = [e.to];
          else if (e.op === 'push') {
            if (node.stack.length >= MAX_STACK_DEPTH) continue;
            after = [...node.stack, e.to];
          } else {
            if (node.stack[node.stack.length - 2] !== e.to) continue;
            after = node.stack.slice(0, -1);
          }
          const first = node.first ?? o.hop;
          if (e.to === target) return first;
          const k = key(after);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push({ stack: after, first });
        }
      }
    }
    frontier = next;
  }
  return null;
}
