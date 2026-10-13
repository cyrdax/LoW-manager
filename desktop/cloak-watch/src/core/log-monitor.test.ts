import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { appendFile, mkdtemp, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { watch } from 'chokidar';

import { LogMonitor, type MonitorDependencies, type MonitorStatus } from './log-monitor.js';
import { TrackedLog } from './tracked-log.js';
import type { DecloakEvent } from './types.js';

const header = 'Listener: Cyrdax Prime\r\n';
const decloak = '[ 2026.09.23 03:04:05 ] (notify) Your cloak deactivates due to proximity.\r\n';

class Watcher extends EventEmitter {
  closed = false;
  async close(): Promise<void> { this.closed = true; }
}

class Scheduler {
  intervals = new Map<() => void, number>();
  timeouts = new Map<() => void, number>();
  every = (ms: number, callback: () => void): (() => void) => {
    this.intervals.set(callback, ms);
    return () => { this.intervals.delete(callback); };
  };
  after = (ms: number, callback: () => void): (() => void) => {
    this.timeouts.set(callback, ms);
    return () => { this.timeouts.delete(callback); };
  };
  fireTimeout(): number {
    const next = this.timeouts.entries().next().value;
    assert.ok(next, 'a bounded watcher retry must be scheduled');
    const [callback, ms] = next;
    this.timeouts.delete(callback);
    callback();
    return ms;
  }
}

async function fixture(t: TestContext, overrides: Partial<MonitorDependencies> = {}, interval = 0) {
  const directory = await mkdtemp(join(tmpdir(), 'cloak-monitor-'));
  const events: DecloakEvent[] = [];
  const statuses: MonitorStatus[] = [];
  const watchers: Watcher[] = [];
  const scheduler = new Scheduler();
  const monitor = new LogMonitor({
    directory,
    onDecloak: (event) => { events.push(event); },
    onStatus: (status) => { statuses.push(status); },
    reconcileIntervalMs: interval,
  }, {
    watch: () => {
      const watcher = new Watcher();
      watchers.push(watcher);
      return watcher;
    },
    scheduler,
    ...overrides,
  });
  t.after(async () => {
    await monitor.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, events, statuses, watchers, scheduler, monitor };
}

test('existing history is skipped and concurrent change/reconciliation delivers each appended record once', async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, 'existing.txt');
  await writeFile(file, header + decloak);
  await f.monitor.start();
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 1 });
  f.watchers[0].emit('add', file); // delayed duplicate add must not reopen at zero
  await appendFile(file, decloak + decloak);
  f.watchers[0].emit('change', file);
  f.watchers[0].emit('change', file);
  await Promise.all([f.monitor.reconcile(), f.monitor.reconcile()]);
  assert.equal(f.events.length, 2);
  assert.deepEqual(f.events.map((event) => event.byteOffset), [99, 174]);
  assert.equal(f.events[0].characterName, 'Cyrdax Prime');
  assert.equal(f.events[0].sourceFile, file);
});

test('new logs read from zero and attribute two clients including fragmented UTF-16 appends', async (t) => {
  const f = await fixture(t);
  await f.monitor.start();
  assert.deepEqual(f.statuses.at(-1), { kind: 'waiting', activeLogs: 0 });
  const first = join(f.directory, 'first.txt');
  const second = join(f.directory, 'second.txt');
  await writeFile(first, header + decloak);
  await writeFile(second, Buffer.from([0xff]));
  f.watchers[0].emit('add', first);
  f.watchers[0].emit('add', second);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
  const bytes = Buffer.from('Listener: Nova Pilot\r\n' + decloak, 'utf16le');
  await appendFile(second, Buffer.concat([Buffer.from([0xfe]), bytes.subarray(0, bytes.length - 3)]));
  f.watchers[0].emit('change', second);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
  await appendFile(second, bytes.subarray(bytes.length - 3));
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.characterName), ['Cyrdax Prime', 'Nova Pilot']);
  assert.equal(f.events[1].byteOffset, 46);
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 2 });
});

test('failed activation messages never produce a decloak callback', async (t) => {
  const f = await fixture(t);
  await f.monitor.start();
  const file = join(f.directory, 'failed.txt');
  await writeFile(file, header + '[ 2026.09.23 03:04:05 ] (notify) Your cloak fails to activate.\r\n');
  f.watchers[0].emit('add', file);
  await f.monitor.reconcile();
  assert.deepEqual(f.events, []);
});

test('reconciliation-discovered and unknown change files skip history even after a delayed add', async (t) => {
  const f = await fixture(t);
  await f.monitor.start();
  const file = join(f.directory, 'missed.txt');
  await writeFile(file, header + decloak);
  f.watchers[0].emit('change', file);
  await f.monitor.reconcile();
  f.watchers[0].emit('add', file);
  const second = join(f.directory, 'missed-too.txt');
  await writeFile(second, header + decloak);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 0);
  await appendFile(file, decloak);
  await appendFile(second, decloak);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 2);
});

test('unlink retires a file and a subsequent add tracks its new generation', async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, 'rotate.txt');
  await writeFile(file, header + decloak);
  await f.monitor.start();
  await unlink(file);
  f.watchers[0].emit('unlink', file);
  await f.monitor.reconcile();
  assert.deepEqual(f.statuses.at(-1), { kind: 'waiting', activeLogs: 0 });
  await writeFile(file, 'Listener: Nova Pilot\r\n' + decloak);
  f.watchers[0].emit('add', file);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].characterName, 'Nova Pilot');
});

test('missed unlink and atomic replacement are reconciled without replaying old generations', async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, 'rotate.txt');
  await writeFile(file, header + decloak);
  await f.monitor.start();
  const replacement = join(f.directory, 'replacement.tmp');
  await writeFile(replacement, 'Listener: Nova Pilot\r\n' + decloak);
  await rename(replacement, file);
  await f.monitor.reconcile();
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].characterName, 'Nova Pilot');
  await unlink(file);
  await f.monitor.reconcile();
  assert.deepEqual(f.statuses.at(-1), { kind: 'waiting', activeLogs: 0 });
});

test('delayed unlink and add preserve a replacement cursor already advanced by reconciliation', async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const replacementRead = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let hold = false;
  const f = await fixture(t, { openLog: async (file, mode) => {
    const tracked = await TrackedLog.open(file, mode);
    return {
      get characterName() { return tracked.characterName; },
      readAppended: async () => {
        const result = await tracked.readAppended();
        if (hold) { entered(); await gate; }
        return result;
      },
    };
  } });
  const file = join(f.directory, 'rotated.txt');
  const replacement = join(f.directory, 'replacement.tmp');
  await writeFile(file, 'Listener: Nova Pilot\r\n' + decloak);
  await f.monitor.start();
  await writeFile(replacement, header + decloak);
  await rename(replacement, file);

  hold = true;
  const reconciliation = f.monitor.reconcile();
  await replacementRead;
  // These notifications describe the old generation's removal and the replacement's arrival.
  f.watchers[0].emit('unlink', file);
  f.watchers[0].emit('add', file);
  hold = false;
  release();
  await reconciliation;
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.byteOffset), [24]);
  assert.equal(f.events[0].characterName, 'Cyrdax Prime');
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 1 });

  await appendFile(file, decloak);
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.byteOffset), [24, 99]);
});

test('truncation allows a new record at a previously seen byte offset', async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, 'truncate.txt');
  await writeFile(file, header);
  await f.monitor.start();
  await appendFile(file, decloak);
  await f.monitor.reconcile();
  await truncate(file, 0);
  await f.monitor.reconcile();
  await appendFile(file, header + decloak);
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.byteOffset), [24, 24]);
});

test('missing directories report an actionable error and recover conservatively', async (t) => {
  const f = await fixture(t);
  const moved = `${f.directory}-moved`;
  await rename(f.directory, moved);
  t.after(() => rm(moved, { recursive: true, force: true }));
  await f.monitor.start();
  const status = f.statuses.at(-1);
  assert.equal(status?.kind, 'error');
  if (status?.kind === 'error') assert.match(status.message, /directory.*(missing|exist|found)|select/i);
  await writeFile(join(moved, 'history.txt'), header + decloak);
  await rename(moved, f.directory);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 1 });
});

test('access loss reports permissions, closes the watcher, and resumes known cursors without replaying newly found history', async (t) => {
  let readable = true;
  const f = await fixture(t, { validateDirectory: async () => readable ? { ok: true } : { ok: false, reason: 'not-readable' } });
  const file = join(f.directory, 'existing.txt');
  await writeFile(file, header + decloak);
  await f.monitor.start();
  readable = false;
  await f.monitor.reconcile();
  const status = f.statuses.at(-1);
  assert.equal(status?.kind, 'error');
  if (status?.kind === 'error') assert.match(status.message, /permission|readable|access/i);
  assert.equal(f.watchers[0].closed, true);
  await appendFile(file, decloak);
  await writeFile(join(f.directory, 'offline.txt'), header + decloak);
  readable = true;
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 2 });
  assert.equal(f.watchers.length, 2);
});

test('unreadable directory on start is contained and continues periodic validation', async (t) => {
  const f = await fixture(t, { validateDirectory: async () => ({ ok: false, reason: 'not-readable' }) }, 2000);
  await f.monitor.start();
  assert.equal(f.statuses.at(-1)?.kind, 'error');
  assert.equal(f.scheduler.intervals.size, 1);
  assert.equal(f.watchers.length, 0);
});

test('watcher failures use bounded restart delays, keep error status, and still reconcile logs after exhaustion', async (t) => {
  let attempts = 0;
  const f = await fixture(t, { watch: () => { attempts++; throw new Error('watch unavailable'); } }, 2000);
  const file = join(f.directory, 'existing.txt');
  await writeFile(file, header);
  await f.monitor.start();
  for (const delay of [1000, 2000, 5000, 10000, 30000]) {
    assert.equal(f.scheduler.fireTimeout(), delay);
    await f.monitor.reconcile();
    assert.equal(f.statuses.at(-1)?.kind, 'error');
  }
  assert.equal(attempts, 6);
  assert.equal(f.scheduler.timeouts.size, 0);
  await appendFile(file, decloak);
  await f.monitor.reconcile();
  assert.equal(attempts, 6);
  assert.equal(f.events.length, 1);
  assert.equal(f.scheduler.intervals.size, 1);
});

test('async watcher errors are contained, stale callbacks ignored, and ready clears recovery status', async (t) => {
  const f = await fixture(t);
  await f.monitor.start();
  f.watchers[0].emit('error', new Error('lost watch'));
  await f.monitor.reconcile();
  assert.equal(f.watchers[0].closed, true);
  assert.equal(f.statuses.at(-1)?.kind, 'error');
  f.scheduler.fireTimeout();
  await f.monitor.reconcile();
  const file = join(f.directory, 'history.txt');
  await writeFile(file, header + decloak);
  f.watchers[0].emit('add', file);
  f.watchers[1].emit('ready');
  await f.monitor.reconcile();
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 1 });
});

test('one unreadable log does not block another client and recovers at its existing cursor', async (t) => {
  let fail = false;
  const f = await fixture(t, {
    openLog: async (file, mode) => {
      const tracked = await TrackedLog.open(file, mode);
      return {
        get characterName() { return tracked.characterName; },
        readAppended: async () => {
          if (fail && file.endsWith('first.txt')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
          return tracked.readAppended();
        },
      };
    },
  });
  const first = join(f.directory, 'first.txt');
  const second = join(f.directory, 'second.txt');
  await writeFile(first, header);
  await writeFile(second, 'Listener: Nova Pilot\r\n');
  await f.monitor.start();
  fail = true;
  await appendFile(first, decloak);
  await appendFile(second, decloak);
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.characterName), ['Nova Pilot']);
  assert.equal(f.statuses.at(-1)?.kind, 'error');
  fail = false;
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.characterName), ['Nova Pilot', 'Cyrdax Prime']);
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 2 });
});

test('stop cancels timers and watcher, suppresses queued and late events, and restart skips offline history', async (t) => {
  const f = await fixture(t, {}, 2000);
  await Promise.all([f.monitor.start(), f.monitor.start()]);
  assert.equal(f.watchers.length, 1);
  assert.equal(f.scheduler.intervals.size, 1);
  const file = join(f.directory, 'late.txt');
  await writeFile(file, header + decloak);
  f.watchers[0].emit('add', file);
  await f.monitor.stop();
  assert.equal(f.watchers[0].closed, true);
  assert.equal(f.scheduler.intervals.size, 0);
  assert.equal(f.scheduler.timeouts.size, 0);
  f.watchers[0].emit('add', file);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 0);
  await f.monitor.start();
  assert.equal(f.events.length, 0);
  await appendFile(file, decloak);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
});

test('stop waits for an in-flight read but never delivers its result or starts a concurrent read', async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let block = false;
  let reading = false;
  const f = await fixture(t, { openLog: async (file, mode) => {
    const tracked = await TrackedLog.open(file, mode);
    return {
      get characterName() { return tracked.characterName; },
      readAppended: async () => {
        assert.equal(reading, false, 'cursor reads must be serialized');
        reading = true;
        if (block) { entered(); await gate; }
        const result = await tracked.readAppended();
        reading = false;
        return result;
      },
    };
  } });
  const file = join(f.directory, 'blocked.txt');
  await writeFile(file, header);
  await f.monitor.start();
  await appendFile(file, decloak);
  block = true;
  f.watchers[0].emit('change', file);
  await started;
  const reconciled = f.monitor.reconcile();
  const stopped = f.monitor.stop();
  release();
  await Promise.all([reconciled, stopped]);
  assert.equal(f.events.length, 0);
  assert.equal(reading, false);
});

test('immediate restart cannot revive an in-flight read from the stopped session', async (t) => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let block = false;
  const f = await fixture(t, { openLog: async (file, mode) => {
    const tracked = await TrackedLog.open(file, mode);
    return {
      get characterName() { return tracked.characterName; },
      readAppended: async () => {
        if (block) { entered(); await gate; }
        return tracked.readAppended();
      },
    };
  } });
  const file = join(f.directory, 'restart.txt');
  await writeFile(file, header);
  await f.monitor.start();
  await appendFile(file, decloak);
  block = true;
  f.watchers[0].emit('change', file);
  await started;
  const stopped = f.monitor.stop();
  const restarted = f.monitor.start();
  release();
  await Promise.all([stopped, restarted]);
  assert.equal(f.events.length, 0);
  await appendFile(file, decloak);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 1);
});

test('watcher add events ignore symlinks and paths outside the selected directory', async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'cloak-monitor-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const file = join(outside, 'outside.txt');
  await writeFile(file, header + decloak);
  await f.monitor.start();
  const link = join(f.directory, 'symlink.txt');
  await symlink(file, link);
  f.watchers[0].emit('add', file);
  f.watchers[0].emit('add', link);
  await f.monitor.reconcile();
  assert.equal(f.events.length, 0);
});

test('callback exceptions cannot stop delivery to other records or poison later reconciliation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cloak-monitor-callback-'));
  let calls = 0;
  const statuses: MonitorStatus[] = [];
  const monitor = new LogMonitor({
    directory, reconcileIntervalMs: 0,
    onDecloak: () => { calls++; if (calls === 1) throw new Error('consumer failed'); },
    onStatus: (status) => { statuses.push(status); throw new Error('status consumer failed'); },
  }, { watch: () => new Watcher() });
  t.after(async () => { await monitor.stop(); await rm(directory, { recursive: true, force: true }); });
  const file = join(directory, 'callbacks.txt');
  await writeFile(file, header);
  await monitor.start();
  await appendFile(file, decloak + decloak);
  await monitor.reconcile();
  await monitor.reconcile();
  assert.equal(calls, 2);
  assert.equal(statuses.at(-1)?.kind, 'error');
});

test('exhausted watcher retries recover after directory access returns and stop cancels a pending retry', async (t) => {
  let readable = true;
  let watchWorks = false;
  const watchers: Watcher[] = [];
  const f = await fixture(t, {
    validateDirectory: async () => readable ? { ok: true } : { ok: false, reason: 'not-readable' },
    watch: () => {
      if (!watchWorks) throw new Error('permission denied');
      const watcher = new Watcher();
      watchers.push(watcher);
      return watcher;
    },
  });
  await f.monitor.start();
  for (let retry = 0; retry < 5; retry++) { f.scheduler.fireTimeout(); await f.monitor.reconcile(); }
  assert.equal(f.scheduler.timeouts.size, 0);
  readable = false;
  await f.monitor.reconcile();
  readable = watchWorks = true;
  await f.monitor.reconcile();
  watchers[0].emit('ready');
  await f.monitor.reconcile();
  assert.deepEqual(f.statuses.at(-1), { kind: 'waiting', activeLogs: 0 });
  watchers[0].emit('error', new Error('again'));
  await f.monitor.reconcile();
  assert.equal(f.scheduler.timeouts.size, 1);
  await f.monitor.stop();
  assert.equal(f.scheduler.timeouts.size, 0);
});

test('the default two-second scheduler reconciles appended logs and is cancelled on stop', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cloak-monitor-periodic-'));
  const scheduler = new Scheduler();
  const events: DecloakEvent[] = [];
  let delivered!: () => void;
  const eventDelivered = new Promise<void>((resolve) => { delivered = resolve; });
  const monitor = new LogMonitor({
    directory,
    onDecloak: (event) => { events.push(event); delivered(); },
    onStatus: () => {},
  }, { scheduler, watch: () => new Watcher() });
  t.after(async () => { await monitor.stop(); await rm(directory, { recursive: true, force: true }); });
  const file = join(directory, 'periodic.txt');
  await writeFile(file, header + decloak);
  await monitor.start();
  await appendFile(file, decloak);
  const [callback, delay] = [...scheduler.intervals][0];
  assert.equal(delay, 2000);
  callback();
  await eventDelivered;
  assert.equal(events.length, 1);
  await monitor.stop();
  assert.equal(scheduler.intervals.size, 0);
});

test('directory enumeration failure closes the watcher and recovers without replay', async (t) => {
  let unavailable = false;
  let files: string[] = [];
  const f = await fixture(t, { listFiles: async () => {
    if (unavailable) throw Object.assign(new Error('directory denied'), { code: 'EACCES' });
    return files;
  } });
  await f.monitor.start();
  unavailable = true;
  await f.monitor.reconcile();
  assert.equal(f.statuses.at(-1)?.kind, 'error');
  assert.equal(f.watchers[0].closed, true);
  const file = join(f.directory, 'offline.txt');
  await writeFile(file, header + decloak);
  files = [file];
  unavailable = false;
  await f.monitor.reconcile();
  assert.deepEqual(f.statuses.at(-1), { kind: 'watching', activeLogs: 1 });
  assert.equal(f.events.length, 0);
});

test('real watcher discovers logs born after the initial snapshot but before its ready event', { timeout: 5000 }, async (t) => {
  let ready!: () => void;
  const watcherReady = new Promise<void>((resolve) => { ready = resolve; });
  const f = await fixture(t, { watch: (directory, options) => {
    // Force the startup race without timing sleeps: snapshot has completed, watcher has not scanned.
    writeFileSync(join(directory, 'born-during-start.txt'), 'Listener: Nova Pilot\r\n' + decloak);
    const watcher = watch(directory, options);
    watcher.once('ready', ready);
    return watcher;
  } });
  await writeFile(join(f.directory, 'history.txt'), header + decloak);
  await f.monitor.start();
  await watcherReady;
  await f.monitor.reconcile();
  assert.deepEqual(f.events.map((event) => event.characterName), ['Nova Pilot']);
});
