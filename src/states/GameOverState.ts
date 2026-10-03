/**
 * GameOver: the only place persistent rewards are committed.
 * enter: summary = run.summary(outcome); cores = computeRunRewards(summary); save.commitRun(runId, delta)
 *   exactly once per runId (the store is idempotent by lastCommittedRunId; this state also remembers which
 *   runs it committed, so entering twice never calls it twice); records/leaderboard are updated by the same
 *   delta; GameOverScreen with MVP / winner and the Cores breakdown; music 'victory' or 'gameover'; the
 *   'gameover' camera push-in on the finished world (still attached, so render() keeps drawing it).
 * Retry replaces with CharacterSelect prefilled with the run's picks and mode; Menu goes to MainMenu.
 * exit: run.dispose(), render.detachWorld(), services.session.current = null.
 */
import type { RunOutcome } from '../contracts/ids';
import type { RunSessionApi, RunSummary } from '../contracts/run';
import type { SaveDataV1 } from '../contracts/save';
import type { Services } from '../contracts/services';
import type { GameState, StatePayloads } from '../contracts/states';
import type { GameOverVM } from '../contracts/ui';
import { computeRunRewards, type RewardBreakdown } from '../upgrades/rewards';
import { IntentReader, indexOfId, wrapIndex, type UiIntent } from './intents';
import { GAME_OVER_ITEMS, buildGameOverVM, runWon } from './viewModels';

const NO_REWARDS: RewardBreakdown = { lines: [], uncapped: 0, total: 0, capped: false };

/** Empty summary used when GameOver is entered without a run (defensive; never in normal flow). */
function emptySummary(outcome: RunOutcome): RunSummary {
  return {
    runId: '',
    mode: 'solo',
    outcome,
    winner: null,
    waveReached: 0,
    wavesCleared: 0,
    bossesKilled: 0,
    victoryAchieved: false,
    shardsEarnedTotal: 0,
    roundsPlayed: 0,
    roundWins: [0, 0],
    durationS: 0,
    totalScore: 0,
    players: [],
    mvp: null,
  };
}

/** New best score (co-op/solo also counts a new best wave). Computed against the records before the commit. */
export function isNewBest(summary: RunSummary, before: SaveDataV1): boolean {
  if (summary.runId === '' || summary.players.length === 0) return false;
  const r = before.records;
  if (summary.totalScore > 0 && summary.totalScore > r.bestScore) return true;
  return summary.mode !== 'versus' && summary.waveReached > r.bestWave;
}

class GameOverStateImpl implements GameState<'GameOver'> {
  readonly id = 'GameOver' as const;
  readonly layer = 'base' as const;
  readonly worldBelow = 'none' as const;
  private readonly s: Services;
  private readonly intents = new IntentReader();
  private readonly committed = new Set<string>();
  private run: RunSessionApi | null = null;
  private summary: RunSummary = emptySummary('defeat');
  private rewards: RewardBreakdown = computeRunRewards(emptySummary('defeat'));
  private newBest = false;
  private cheated = false;
  private cursor = 0;
  private dirty = true;
  private leaving = false;

  constructor(s: Services) {
    this.s = s;
  }

  enter(payload: StatePayloads['GameOver']): void {
    const s = this.s;
    const run = s.session.current;
    this.run = run;
    this.cursor = 0;
    this.leaving = false;
    if (run === null) s.log.error('GameOver entered without a run');
    // A co-op/solo run that beat the final boss is a win however OVERFLOW ended it (death or abandon).
    const won = run !== null && run.config.mode !== 'versus' && run.world.run.victoryAchieved;
    const outcome: RunOutcome = won ? 'victory' : payload.outcome;
    this.summary = run === null ? emptySummary(outcome) : run.summary(outcome);
    // TERMINAL cheat runs pay nothing and never reach records or the leaderboard.
    this.cheated = run !== null && run.config.mode !== 'versus' && (run.config.cheats?.length ?? 0) > 0;
    this.rewards = this.cheated ? NO_REWARDS : computeRunRewards(this.summary);
    // Re-entering for a run already shown keeps its "new best" (the records now include it).
    if (!this.committed.has(this.summary.runId))
      this.newBest = !this.cheated && isNewBest(this.summary, s.save.data);
    this.commit();
    if (this.cheated)
      s.ui.toast(`Cheats were on: no ${s.theme().names.metaCurrency} and no records this run.`, 'warn');
    s.input.setContext('menu');
    s.render.setCameraMode('gameover');
    s.audio.duck(false);
    s.audio.setMood(this.victoryMood() ? 'victory' : 'gameover');
    this.intents.open(s.ui, 'gameOver');
    s.ui.show('gameOver', this.vm());
    this.dirty = false;
  }

  exit(): void {
    const s = this.s;
    this.intents.close();
    s.ui.hide('gameOver');
    const run = this.run;
    this.run = null;
    if (run !== null) run.dispose();
    s.render.detachWorld();
    s.session.current = null;
  }

  update(frameDt: number): void {
    const intents = this.intents.read(this.s.input, frameDt * 1000);
    for (const i of intents) {
      if (this.leaving) return;
      this.handle(i);
    }
    if (this.dirty) {
      this.dirty = false;
      this.s.ui.update('gameOver', this.vm());
    }
  }

  render(alpha: number, frameDt: number): void {
    if (this.run === null) return;
    this.s.render.setBeat(this.s.audio.beatPhase);
    this.s.render.frame(alpha, frameDt);
  }

  private victoryMood(): boolean {
    return runWon(this.summary);
  }

  private commit(): void {
    const s = this.s;
    const sm = this.summary;
    if (sm.runId === '' || this.committed.has(sm.runId)) return;
    if (s.save.data.lastCommittedRunId === sm.runId) {
      this.committed.add(sm.runId);
      return;
    }
    this.committed.add(sm.runId);
    // A cheat run only marks its id as committed (no Cores, no records).
    const res = s.save.commitRun(sm.runId, this.cheated ? {} : { coresDelta: this.rewards.total, run: sm });
    if (res.ok) return;
    switch (res.error) {
      case 'duplicate':
        s.log.info('GameOver: run already committed', sm.runId);
        return;
      case 'readOnly':
        s.ui.toast('Read-only save: this run was not recorded.', 'warn');
        return;
      case 'quota':
      case 'unavailable':
        s.ui.toast('Could not write the save: rewards are kept for this session only.', 'error');
        return;
    }
  }

  private handle(i: UiIntent): void {
    switch (i.kind) {
      case 'up':
      case 'down':
      case 'left':
      case 'right': {
        const delta = i.kind === 'up' || i.kind === 'left' ? -1 : 1;
        this.cursor = wrapIndex(this.cursor, delta, GAME_OVER_ITEMS.length);
        this.dirty = true;
        this.s.audio.play('uiMove');
        return;
      }
      case 'confirm': {
        const target = i.pointer ? indexOfId(GAME_OVER_ITEMS, i.itemId) : this.cursor;
        if (target < 0) return;
        this.cursor = target;
        this.dirty = true;
        if (GAME_OVER_ITEMS[target]!.id === 'retry') this.retry();
        else this.toMenu();
        return;
      }
      case 'back':
      case 'ready':
      case 'pause':
        return;
    }
  }

  private retry(): void {
    const s = this.s;
    const run = this.run;
    const picks = run !== null ? run.config.players : s.session.lastPicks;
    const mode = run !== null ? run.config.mode : s.session.lastMode;
    s.audio.play('uiConfirm');
    this.leaving = s.fsm.request('CharacterSelect', {
      prefill: picks,
      mode: mode === 'solo' ? null : mode,
    });
  }

  private toMenu(): void {
    this.s.audio.play('uiBack');
    this.leaving = this.s.fsm.request('MainMenu');
  }

  private vm(): GameOverVM {
    return buildGameOverVM(this.summary, this.rewards, this.s.theme(), this.cursor, this.newBest);
  }
}

export function createGameOverState(s: Services): GameState<'GameOver'> {
  return new GameOverStateImpl(s);
}
