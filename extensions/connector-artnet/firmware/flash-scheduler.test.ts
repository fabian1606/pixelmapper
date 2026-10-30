// @vitest-environment node
/**
 * Batch scheduler (plan D17): one job per port, ports in parallel, failures
 * continue, cancel all, and the bridge-owned job model (adoption before
 * the `flash` answer, attached jobs, lost answers, `flashJobs` sync).
 */
import { describe, expect, it } from 'vitest';
import { BridgeCommandError } from '../bridge/backend';
import type { FlashJob } from '../bridge/protocol-model';
import type { FlashRequest, FlashRunner } from './flash-item';
import { FlashScheduler } from './flash-scheduler';
import { HEX, NODE_ID, T1, T2, T3, makeImage, makeJob, port } from './testing/fixtures';

/** A `flash` call waiting for its answer. */
interface PendingStart {
  request: FlashRequest & { hex: string };
  resolve: (job: FlashJob) => void;
  reject: (err: unknown) => void;
}

/** Runner whose `flash` answers are given by the test. */
class FakeRunner implements FlashRunner {
  readonly starts: PendingStart[] = [];
  readonly cancels: string[] = [];
  cancelError: unknown = null;

  start(request: FlashRequest & { hex: string }): Promise<FlashJob> {
    return new Promise((resolve, reject) => this.starts.push({ request, resolve, reject }));
  }

  async cancel(jobId: string): Promise<void> {
    this.cancels.push(jobId);
    if (this.cancelError) throw this.cancelError;
  }

  /** UIDs of the `flash` calls so far. */
  get started(): string[] {
    return this.starts.map(s => s.request.uid);
  }

  /** Answers the `flash` call of `uid` with a job in phase `entering`. */
  answer(uid: string, jobId: string): FlashJob {
    const s = this.starts.find(x => x.request.uid === uid)!;
    const job = makeJob({ jobId, uid, port: s.request.port, nodeId: s.request.nodeId });
    s.resolve(job);
    return job;
  }
}

/** Request for a tube on port `bind`. */
const req = (uid: string, bind: number, allowDowngrade = false): FlashRequest => ({ nodeId: NODE_ID, port: port(bind), uid, allowDowngrade, image: makeImage() });

/** Lets promise callbacks run. */
const tick = () => new Promise(r => setTimeout(r, 0));

/** A scheduler with a fake runner; `changes` counts notifications. */
function setup(options: { paused?: boolean } = {}) {
  const runner = new FakeRunner();
  let lost = 0;
  const scheduler = new FlashScheduler({ runner, paused: options.paused, onLost: () => { lost++; } });
  const status = (uid: string) => scheduler.items().filter(i => i.uid === uid).at(-1)?.status;
  return { runner, scheduler, status, lost: () => lost };
}

describe('FlashScheduler', () => {
  it('runs one job per port and the ports in parallel', () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1), req(T2, 1), req(T3, 2)], HEX);
    expect(runner.started).toEqual([T1, T3]);
    expect([status(T1), status(T2), status(T3)]).toEqual(['starting', 'queued', 'starting']);
    expect(runner.starts[0]!.request).toMatchObject({ nodeId: NODE_ID, port: port(1), uid: T1, hex: HEX, allowDowngrade: false });
  });

  it('starts the next tube of a port when the job is done', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1), req(T2, 1)], HEX);
    const job = runner.answer(T1, 'f1');
    await tick();
    expect(status(T1)).toBe('running');
    scheduler.handleProgress({ ...job, phase: 'writing', pagesDone: 10 });
    expect(runner.started).toEqual([T1]);
    scheduler.handleProgress({ ...job, phase: 'done', result: { softwareVersionId: 0x010200, softwareVersionLabel: '1.2.0' } });
    expect(status(T1)).toBe('done');
    expect(runner.started).toEqual([T1, T2]);
  });

  it('continues after a failed job and after a rejected start', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1), req(T2, 1), req(T3, 1)], HEX);
    const job = runner.answer(T1, 'f1');
    await tick();
    scheduler.handleProgress({ ...job, phase: 'failed', inBootloader: true, error: { code: 'timeout', message: 'BOOT_INFO: no answer' } });
    const failed = scheduler.items()[0]!;
    expect(failed).toMatchObject({ status: 'failed', error: 'No answer from the device', errorDetail: 'BOOT_INFO: no answer' });
    expect(runner.started).toEqual([T1, T2]);
    runner.starts[1]!.reject(new BridgeCommandError('deviceMismatch', 'model 0x0002'));
    await tick();
    expect(scheduler.items()[1]).toMatchObject({ status: 'failed', error: 'The device\'s manufacturer or model does not match the image' });
    expect(runner.started).toEqual([T1, T2, T3]);
    expect(status(T3)).toBe('starting');
  });

  it('cancels everything: queued tubes never start, running jobs get flashCancel', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1), req(T2, 1)], HEX);
    const job = runner.answer(T1, 'f1');
    await tick();
    await scheduler.cancel();
    expect(runner.cancels).toEqual(['f1']);
    expect([status(T1), status(T2)]).toEqual(['cancelling', 'cancelled']);
    scheduler.handleProgress({ ...job, phase: 'writing', pagesDone: 3 }); // late event: still cancelling
    expect(status(T1)).toBe('cancelling');
    scheduler.handleProgress({ ...job, phase: 'cancelled', inBootloader: true });
    expect(status(T1)).toBe('cancelled');
    expect(runner.started).toEqual([T1]);
  });

  it('cancels a starting tube as soon as its job id is known', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1)], HEX);
    await scheduler.cancel(item => item.uid === T1);
    expect(runner.cancels).toEqual([]);
    runner.answer(T1, 'f1');
    await tick();
    expect(runner.cancels).toEqual(['f1']);
    expect(status(T1)).toBe('cancelling');
  });

  it('a cancelled start that the bridge rejected ends as cancelled', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1)], HEX);
    await scheduler.cancel();
    runner.starts[0]!.reject(new BridgeCommandError('timeout', 'no answer'));
    await tick();
    expect(status(T1)).toBe('cancelled');
  });

  it('adopts progress that arrives before the flash answer', async () => {
    const { runner, scheduler } = setup();
    scheduler.enqueue([req(T1, 1)], HEX);
    scheduler.handleProgress(makeJob({ jobId: 'f9', phase: 'entering' }));
    expect(scheduler.items()).toHaveLength(1);
    expect(scheduler.items()[0]).toMatchObject({ status: 'running', ours: true, job: { jobId: 'f9' } });
    runner.answer(T1, 'f9');
    await tick();
    expect(scheduler.items()[0]!.status).toBe('running');
  });

  it('never adopts a job of the tube that existed before the start', () => {
    const { scheduler } = setup();
    scheduler.handleProgress(makeJob({ jobId: 'old', phase: 'done' }));
    scheduler.enqueue([req(T1, 1)], HEX);
    scheduler.handleProgress(makeJob({ jobId: 'old', phase: 'done' }));
    const items = scheduler.items();
    expect(items.map(i => [i.ours, i.status])).toEqual([[true, 'starting']]);
  });

  it('shows jobs started elsewhere and waits for their port', () => {
    const { runner, scheduler, status } = setup();
    const foreign = makeJob({ jobId: 'x1', uid: T2, phase: 'writing', pagesDone: 4 });
    scheduler.handleProgress(foreign);
    expect(scheduler.items()[0]).toMatchObject({ uid: T2, ours: false, status: 'running' });
    scheduler.enqueue([req(T1, 1), req(T3, 2)], HEX);
    expect(runner.started).toEqual([T3]);
    scheduler.handleProgress({ ...foreign, phase: 'done' });
    expect(status(T2)).toBe('done');
    expect(runner.started).toEqual([T3, T1]);
  });

  it('busy: waits when another job holds the port, else fails', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1), req(T3, 2)], HEX);
    // A job of another window shows up on port 1 before the bridge answers busy.
    scheduler.handleProgress(makeJob({ jobId: 'x1', uid: T2, phase: 'entering' }));
    runner.starts[0]!.reject(new BridgeCommandError('busy', 'busy'));
    runner.starts[1]!.reject(new BridgeCommandError('busy', 'busy'));
    await tick();
    expect(status(T1)).toBe('queued');
    expect(scheduler.items().find(i => i.uid === T3)).toMatchObject({ status: 'failed', error: 'Another firmware update is running on this port' });
    scheduler.handleProgress(makeJob({ jobId: 'x1', uid: T2, phase: 'failed' }));
    expect(runner.started).toEqual([T1, T3, T1]);
  });

  it('starts nothing while paused', () => {
    const { runner, scheduler } = setup({ paused: true });
    scheduler.enqueue([req(T1, 1)], HEX);
    expect(runner.started).toEqual([]);
    scheduler.resume();
    expect(runner.started).toEqual([T1]);
    expect(scheduler.paused).toBe(false);
  });

  it('a lost flash answer is settled by the next sync', async () => {
    const { runner, scheduler, status, lost } = setup();
    scheduler.enqueue([req(T1, 1), req(T3, 2)], HEX);
    runner.starts[0]!.reject(new BridgeCommandError('disconnected', 'connection lost'));
    runner.starts[1]!.reject(new BridgeCommandError('requestTimeout', 'no answer'));
    await tick();
    expect(lost()).toBe(2);
    expect([status(T1), status(T3)]).toEqual(['starting', 'starting']);
    // T1's job runs in the bridge; T3's never started.
    scheduler.sync([makeJob({ jobId: 'f1', uid: T1, phase: 'writing', pagesDone: 5 })]);
    expect(scheduler.items().find(i => i.uid === T1)).toMatchObject({ status: 'running', ours: true, job: { jobId: 'f1' } });
    expect(scheduler.items().find(i => i.uid === T3)).toMatchObject({ status: 'failed', error: 'The Art-Net bridge did not answer in time' });
  });

  it('sync: updates own jobs, fails jobs the bridge forgot, attaches each tube\'s latest finished job', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1), req(T3, 2)], HEX);
    runner.answer(T1, 'f1');
    runner.answer(T3, 'f3');
    await tick();
    scheduler.sync([
      makeJob({ jobId: 'f1', uid: T1, phase: 'done' }),
      makeJob({ jobId: 'a', uid: T2, phase: 'failed' }),
      makeJob({ jobId: 'b', uid: T2, phase: 'done' }),
    ]);
    expect(status(T1)).toBe('done');
    expect(scheduler.items().find(i => i.uid === T3)).toMatchObject({ status: 'failed', error: 'The bridge no longer reports this update (was it restarted?)' });
    expect(scheduler.items().filter(i => i.uid === T2).map(i => [i.job?.jobId, i.ours, i.status])).toEqual([['b', false, 'done']]);
  });

  it('skips tubes with a pending update and replaces finished items', async () => {
    const { runner, scheduler } = setup();
    scheduler.enqueue([req(T1, 1)], HEX);
    expect(scheduler.enqueue([req(T1, 1)], HEX)).toEqual([]);
    const job = runner.answer(T1, 'f1');
    await tick();
    scheduler.handleProgress({ ...job, phase: 'failed' });
    const again = scheduler.enqueue([req(T1, 1, true)], HEX);
    expect(again).toHaveLength(1);
    expect(scheduler.items()).toHaveLength(1);
    expect(scheduler.items()[0]).toMatchObject({ status: 'starting', allowDowngrade: true });
  });

  it('never goes back from a finished phase of the same job', async () => {
    const { runner, scheduler, status } = setup();
    scheduler.enqueue([req(T1, 1)], HEX);
    const job = runner.answer(T1, 'f1');
    await tick();
    scheduler.handleProgress({ ...job, phase: 'done' });
    scheduler.sync([{ ...job, phase: 'writing' }]);
    expect(status(T1)).toBe('done');
  });

  it('ignores a cancel for a job the bridge already forgot', async () => {
    const { runner, scheduler, status } = setup();
    runner.cancelError = new BridgeCommandError('unknownJob', 'unknown');
    scheduler.enqueue([req(T1, 1)], HEX);
    runner.answer(T1, 'f1');
    await tick();
    await expect(scheduler.cancel()).resolves.toBeUndefined();
    expect(status(T1)).toBe('cancelling');
    scheduler.sync([]);
    expect(status(T1)).toBe('cancelled');
  });
});
