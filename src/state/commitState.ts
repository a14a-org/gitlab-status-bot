import { Firestore } from '@google-cloud/firestore';
import { config } from '../config';
import { CommitState, commitKey } from '../domain/types';
import { logger } from '../logging';

const COLLECTION = 'commit-states';

let _db: Firestore | undefined;
const db = (): Firestore => {
    if (!_db) {
        // Firestore rejects documents containing `undefined`. Dropping such
        // fields is the correct behaviour for this schema: every optional field
        // means "not known yet".
        _db = new Firestore({ ignoreUndefinedProperties: true });
    }
    return _db;
};

/**
 * Recursively removes keys whose value is `undefined`.
 *
 * Applied on both backends deliberately. The in-memory backend round-trips
 * through JSON, which drops undefined silently, so without this the two
 * backends disagree and the test suite cannot see a Firestore rejection.
 */
export const stripUndefined = <T>(value: T): T => {
    if (Array.isArray(value)) {
        // Firestore rejects undefined inside arrays too, and mapping it through
        // would leave it in place. Nothing in this schema stores sparse arrays.
        return value.filter((v) => v !== undefined).map(stripUndefined) as unknown as T;
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v !== undefined) {
                out[k] = stripUndefined(v);
            }
        }
        return out as T;
    }
    return value;
};

const useMemory = (): boolean => process.env.PIPELINE_STATE_BACKEND === 'memory';
const memoryStore = new Map<string, CommitState>();

const clone = <T>(value: T): T =>
    value === undefined ? (undefined as T) : (JSON.parse(JSON.stringify(value)) as T);

/**
 * Read-modify-write against a single commit document.
 *
 * GitLab delivers pipeline and job hooks in bursts — 11 deliveries inside one
 * second is normal for a large deploy — and Cloud Run serves them concurrently on
 * one event loop. Doing this without a transaction loses job status updates,
 * which is why jobs used to get stuck showing "pending" forever.
 *
 * `mutate` must be pure with respect to the passed state: Firestore may invoke
 * it more than once when it retries a contended transaction.
 */
export const updateCommitState = async (
    projectId: number,
    sha: string,
    mutate: (current: CommitState | undefined) => CommitState | undefined
): Promise<CommitState | undefined> => {
    const key = commitKey(projectId, sha);

    if (useMemory()) {
        const next = mutate(clone(memoryStore.get(key)));
        if (next) {
            memoryStore.set(key, stripUndefined(clone(next)));
        }
        return next;
    }

    const ref = db().collection(COLLECTION).doc(key);

    return db().runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const current = doc.exists ? (doc.data() as CommitState) : undefined;
        const next = mutate(current);

        if (next) {
            tx.set(ref, stripUndefined(next));
        }
        return next;
    });
};

export const getCommitState = async (
    projectId: number,
    sha: string
): Promise<CommitState | undefined> => {
    const key = commitKey(projectId, sha);

    if (useMemory()) {
        return clone(memoryStore.get(key));
    }

    const doc = await db().collection(COLLECTION).doc(key).get();
    return doc.exists ? (doc.data() as CommitState) : undefined;
};

export const deleteCommitState = async (projectId: number, sha: string): Promise<void> => {
    const key = commitKey(projectId, sha);

    if (useMemory()) {
        memoryStore.delete(key);
        return;
    }

    await db().collection(COLLECTION).doc(key).delete();
};

/**
 * Drop commit state past its TTL. The previous implementation existed but was
 * never wired up, leaving documents in Firestore back to 2025-07.
 */
export const cleanupOldStates = async (): Promise<number> => {
    const cutoff = Date.now() - config.stateTtlDays() * 24 * 60 * 60 * 1000;

    if (useMemory()) {
        let removed = 0;
        for (const [key, state] of memoryStore.entries()) {
            if (state.updatedAt < cutoff) {
                memoryStore.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    const snapshot = await db()
        .collection(COLLECTION)
        .where('updatedAt', '<', cutoff)
        .limit(400)
        .get();

    if (snapshot.empty) {
        return 0;
    }

    const batch = db().batch();
    for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
    }
    await batch.commit();

    logger.info('Cleaned up expired commit state', { removed: snapshot.size });
    return snapshot.size;
};

/** Test seam. */
export const __resetMemoryStore = (): void => memoryStore.clear();
