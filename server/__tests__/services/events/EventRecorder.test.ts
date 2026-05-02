import { EventRecorder } from '@/services/events/EventRecorder';
import { Db } from '@/services/db/Db';

describe('EventRecorder', () => {
  it('inserts an app_open event with the typed payload', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    recorder.record('u1', 'app_open', {
      appVersion: '1.0.0',
      platform: 'ios',
      buildNumber: 100,
    });
    const row = db.prepare<{ user_id: string; event_type: string; payload_json: string }>(
      'SELECT user_id, event_type, payload_json FROM app_events',
    ).get()!;
    expect(row.user_id).toBe('u1');
    expect(row.event_type).toBe('app_open');
    expect(JSON.parse(row.payload_json)).toEqual({
      appVersion: '1.0.0',
      platform: 'ios',
      buildNumber: 100,
    });
    db.close();
  });

  it('inserts a broadcast_started event with broadcastId attached', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    recorder.record('u1', 'broadcast_started', {
      vibe: 'morning',
      length: 'standard',
      source: 'user',
    }, { broadcastId: 'b1' });
    const row = db.prepare<{ broadcast_id: string }>(
      'SELECT broadcast_id FROM app_events',
    ).get()!;
    expect(row.broadcast_id).toBe('b1');
    db.close();
  });

  it('records every event type with its payload shape', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    recorder.record('u1', 'broadcast_completed', { durationMs: 30000, segmentsPlayed: 4 }, { broadcastId: 'b1' });
    recorder.record('u1', 'broadcast_failed', { slotIndex: 2, provider: 'voxcpm', errorCategory: 'timeout' }, { broadcastId: 'b1' });
    recorder.record('u1', 'track_completed', { trackIndex: 0, wasSkipped: false, listenedMs: 200000 }, { broadcastId: 'b1' });
    const { n } = db.prepare<{ n: number }>(
      'SELECT COUNT(*) AS n FROM app_events',
    ).get()!;
    expect(n).toBe(3);
    db.close();
  });

  it('stamps occurred_at with the current time', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    const before = Date.now();
    recorder.record('u1', 'app_open', { appVersion: '1', platform: 'ios', buildNumber: 1 });
    const after = Date.now();
    const { occurred_at } = db.prepare<{ occurred_at: number }>(
      'SELECT occurred_at FROM app_events',
    ).get()!;
    expect(occurred_at).toBeGreaterThanOrEqual(before);
    expect(occurred_at).toBeLessThanOrEqual(after);
    db.close();
  });

  it('swallows DB errors when the connection is closed (best-effort contract)', () => {
    const db = new Db(':memory:');
    const recorder = new EventRecorder(db);
    db.close();
    // The Db handle is closed; the next prepare/run inside record() will throw
    // at the better-sqlite3 layer. EventRecorder must catch and swallow so the
    // orchestrator's promise chain isn't disrupted by telemetry failures.
    expect(() => {
      recorder.record('u1', 'app_open', { appVersion: '1.0', platform: 'ios', buildNumber: 1 });
    }).not.toThrow();
  });
});
