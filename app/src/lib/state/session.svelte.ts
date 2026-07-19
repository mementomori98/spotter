import { getMeta, setMeta } from '$lib/storage/meta';
import type { Session } from '$lib/storage/types';
import { newDeviceId } from '$lib/util/ids';

/**
 * Local account. Created (and usable) fully offline; registered with the
 * server at first successful sync. One account per device, no logout (v1).
 */
class SessionState {
  current = $state<Session | null>(null);

  async load(): Promise<void> {
    this.current = (await getMeta<Session>('session')) ?? null;
  }

  async create(username: string, password: string): Promise<void> {
    const session: Session = {
      username: username.trim().toLowerCase(),
      password,
      deviceId: newDeviceId(),
      userId: null,
      token: null,
      registered: false
    };
    await setMeta('session', session);
    this.current = session;
  }

  /** Persist mutations (token renewal, registration, rename). */
  async update(patch: Partial<Session>): Promise<void> {
    if (!this.current) return;
    this.current = { ...this.current, ...patch };
    await setMeta('session', snapshotOf(this.current));
  }

  get deviceId(): string {
    return this.current?.deviceId ?? 'unknown';
  }
}

function snapshotOf<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const session = new SessionState();
