import { WebClient } from '@slack/web-api';
import { config } from '../config';
import { rollUp, shouldPostCard } from '../domain/aggregate';
import { CommitState, commitKey } from '../domain/types';
import { logger } from '../logging';
import { getCommitState, updateCommitState } from '../state/commitState';
import { buildCardFallbackText, buildCommitCard, renderHash } from '../views/commitCard';

/** Serialises work per commit so two bursts cannot both post the first card. */
class KeyedMutex {
    private chains = new Map<string, Promise<unknown>>();

    run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.chains.get(key) ?? Promise.resolve();
        const next = previous.then(task, task);
        this.chains.set(
            key,
            next.catch(() => undefined).finally(() => {
                if (this.chains.get(key) === next) {
                    this.chains.delete(key);
                }
            })
        );
        return next;
    }
}

const mutex = new KeyedMutex();
const timers = new Map<string, NodeJS.Timeout>();
const inflight = new Set<Promise<unknown>>();

export interface RenderTarget {
    projectId: number;
    sha: string;
}

/**
 * Coalesces progress updates.
 *
 * A large monorepo pipeline emits ~70 job transitions. Rendering each one is both
 * pointless and enough to hit Slack's per-channel update limit, so intermediate
 * events are batched into one call per window while terminal states render
 * straight away.
 */
export const scheduleRender = (
    client: WebClient,
    target: RenderTarget,
    options: { immediate?: boolean } = {}
): void => {
    const key = commitKey(target.projectId, target.sha);
    const existing = timers.get(key);

    if (options.immediate) {
        if (existing) {
            clearTimeout(existing);
            timers.delete(key);
        }
        track(render(client, target));
        return;
    }

    if (existing) {
        // Already scheduled — this event folds into the pending render.
        return;
    }

    const timer = setTimeout(() => {
        timers.delete(key);
        track(render(client, target));
    }, config.updateDebounceMs());

    timers.set(key, timer);
};

const track = (promise: Promise<unknown>): void => {
    inflight.add(promise);
    promise
        .catch((error) => logger.error('Render failed', error))
        .finally(() => inflight.delete(promise));
};

/** Flush pending work so a SIGTERM does not drop the final status update. */
export const flushPendingRenders = async (client: WebClient): Promise<void> => {
    for (const [key, timer] of [...timers.entries()]) {
        clearTimeout(timer);
        timers.delete(key);
        const [projectId, sha] = key.split('_');
        track(render(client, { projectId: Number(projectId), sha }));
    }
    await Promise.allSettled([...inflight]);
};

const render = (client: WebClient, target: RenderTarget): Promise<void> =>
    mutex.run(commitKey(target.projectId, target.sha), async () => {
        const state = await getCommitState(target.projectId, target.sha);
        if (!state) {
            return;
        }

        const rollup = rollUp(state);

        if (!shouldPostCard(state, rollup)) {
            logger.debug('Skipping card for non-deploying ref', {
                ref: state.ref,
                sha: state.sha,
                status: rollup.status,
            });
            return;
        }

        const blocks = buildCommitCard(state, rollup);
        const text = buildCardFallbackText(state, rollup);
        const hash = renderHash(blocks);

        if (state.ts && state.lastRenderHash === hash) {
            return;
        }

        if (state.ts && state.channel) {
            await client.chat.update({ channel: state.channel, ts: state.ts, blocks, text });
            await persistRender(target, hash);
            logger.info('Updated commit card', {
                sha: state.sha,
                ref: state.ref,
                status: rollup.status,
                jobs: rollup.jobs.length,
            });
            return;
        }

        await postFirstCard(client, target, state, blocks, text, hash);
    });

const postFirstCard = async (
    client: WebClient,
    target: RenderTarget,
    state: CommitState,
    blocks: ReturnType<typeof buildCommitCard>,
    text: string,
    hash: string
): Promise<void> => {
    const result = await client.chat.postMessage({
        channel: config.slack.channelId(),
        blocks,
        text,
    });

    if (!result.ok || !result.ts || !result.channel) {
        logger.error('Slack rejected the initial card', undefined, { sha: state.sha });
        return;
    }

    // Claim the message identity transactionally. If a concurrent render beat
    // us to it, retract ours rather than leaving a duplicate in the channel.
    let claimed = true;
    await updateCommitState(target.projectId, target.sha, (current) => {
        if (!current) return current;
        if (current.ts) {
            claimed = false;
            return current;
        }
        return {
            ...current,
            ts: result.ts as string,
            channel: result.channel as string,
            lastRenderHash: hash,
            updatedAt: Date.now(),
        };
    });

    if (!claimed) {
        logger.warn('Discarding duplicate card lost a post race', { sha: state.sha });
        await client.chat
            .delete({ channel: result.channel, ts: result.ts })
            .catch((error) => logger.error('Failed to retract duplicate card', error));
        return;
    }

    logger.info('Posted commit card', { sha: state.sha, ref: state.ref, ts: result.ts });
};

const persistRender = async (target: RenderTarget, hash: string): Promise<void> => {
    await updateCommitState(target.projectId, target.sha, (current) =>
        current ? { ...current, lastRenderHash: hash, updatedAt: Date.now() } : current
    );
};
