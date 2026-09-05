import type { ChildProcess } from 'node:child_process';
import type { Job, JobKind } from '@studio/shared';
import { AGENT_CONCURRENCY } from '@studio/shared';
import type { WsHub } from '../ws';
import { runJob } from './runner';

const MAX_HISTORY = 40;
let counter = 0;

interface DeckJobs {
  jobs: Job[]; // chronological (oldest first)
  procs: Map<string, ChildProcess>;
  running: number;
}

export interface EnqueueInput {
  kind: JobKind;
  targetKey: string | null;
  targetLabel: string;
  prompt: string;
  batchId?: string | null;
}

class JobManager {
  private decks = new Map<string, DeckJobs>();

  private deck(deckId: string): DeckJobs {
    let d = this.decks.get(deckId);
    if (!d) {
      d = { jobs: [], procs: new Map(), running: 0 };
      this.decks.set(deckId, d);
    }
    return d;
  }

  list(deckId: string): Job[] {
    return this.deck(deckId).jobs;
  }

  enqueue(deckId: string, input: EnqueueInput, hub: WsHub): Job {
    const d = this.deck(deckId);
    const job: Job = {
      id: `job-${Date.now()}-${++counter}`,
      deckId,
      kind: input.kind,
      targetKey: input.targetKey,
      targetLabel: input.targetLabel,
      batchId: input.batchId ?? null,
      prompt: input.prompt,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      resultSlideKey: null,
    };
    d.jobs.push(job);
    this.trimHistory(d);
    hub.broadcast(deckId, { type: 'job-update', deckId, job });
    this.schedule(deckId, hub);
    return job;
  }

  cancel(deckId: string, jobId: string, hub: WsHub): void {
    const d = this.deck(deckId);
    const job = d.jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      hub.broadcast(deckId, { type: 'job-update', deckId, job });
    } else if (job.status === 'running') {
      job.status = 'cancelled';
      d.procs.get(jobId)?.kill('SIGTERM');
      hub.broadcast(deckId, { type: 'job-update', deckId, job });
    }
  }

  private trimHistory(d: DeckJobs): void {
    while (d.jobs.length > MAX_HISTORY) {
      const idx = d.jobs.findIndex(
        (j) => j.status === 'done' || j.status === 'error' || j.status === 'cancelled',
      );
      if (idx === -1) break;
      d.jobs.splice(idx, 1);
    }
  }

  private schedule(deckId: string, hub: WsHub): void {
    const d = this.deck(deckId);
    while (d.running < AGENT_CONCURRENCY) {
      const next = d.jobs.find((j) => j.status === 'queued');
      if (!next) break;
      this.start(deckId, next, hub);
    }
  }

  private start(deckId: string, job: Job, hub: WsHub): void {
    const d = this.deck(deckId);
    job.status = 'running';
    job.startedAt = Date.now();
    d.running += 1;
    hub.broadcast(deckId, { type: 'job-update', deckId, job });

    const child = runJob(
      job,
      (kind, text) => hub.broadcast(deckId, { type: 'job-log', deckId, jobId: job.id, kind, text }),
      (result) => {
        d.procs.delete(job.id);
        d.running = Math.max(0, d.running - 1);
        if (job.status !== 'cancelled') {
          job.status = result.ok ? 'done' : 'error';
          job.error = result.ok ? null : result.error ?? 'Failed';
          job.resultSlideKey = result.resultSlideKey ?? null;
        }
        job.finishedAt = Date.now();
        hub.broadcast(deckId, { type: 'job-update', deckId, job });
        this.schedule(deckId, hub);
      },
    );
    d.procs.set(job.id, child);
  }
}

export const jobManager = new JobManager();
