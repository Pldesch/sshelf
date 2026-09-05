import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeckModel, Job, JobKind } from '@studio/shared';
import { AGENT_CONCURRENCY } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import { findSlide } from '../lib/locate';
import * as api from '../api/client';
import { MentionTextarea } from './MentionTextarea';

function flatSlides(model: DeckModel): { key: string; label: string }[] {
  return model.slides.map((s, i) => ({
    key: s.key,
    label: `${i + 1}  ${s.id ? `#${s.id}` : s.title || ''}`.trim(),
  }));
}

const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'Queued',
  running: 'Working…',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
};

export function FleetPanel() {
  const deckId = useStudio((s) => s.currentDeckId);
  const model = useStudio((s) => s.model);
  const selectedKey = useStudio((s) => s.selectedKey);
  const jobs = useStudio((s) => s.jobs);
  const jobLogs = useStudio((s) => s.jobLogs);
  const agentIntent = useStudio((s) => s.agentIntent);
  const showToast = useStudio((s) => s.showToast);

  const [mode, setMode] = useState<JobKind | 'multi'>('create');
  const rootRef = useRef<HTMLDivElement>(null);
  const [editKey, setEditKey] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(5);
  const [afterCurrent, setAfterCurrent] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (selectedKey) setEditKey(selectedKey);
  }, [selectedKey]);

  // A ⌘K / shortcut request to open Agents in a specific mode: apply it once, then focus
  // the prompt so you can type and ⌘⏎ immediately. No cleanup — consuming the intent
  // re-runs this effect, and a cleanup would cancel the pending focus before it fires.
  useEffect(() => {
    if (!agentIntent.pending) return;
    if (agentIntent.mode) setMode(agentIntent.mode);
    useStudio.getState().consumeAgentIntent();
    requestAnimationFrame(() => rootRef.current?.querySelector('textarea')?.focus());
  }, [agentIntent]);

  const slides = useMemo(() => (model ? flatSlides(model) : []), [model]);
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const ordered = useMemo(() => [...jobs].reverse(), [jobs]);

  if (!deckId) return <div className="panel-empty">No deck open.</div>;

  async function enqueue() {
    const p = prompt.trim();
    if (!p) return;
    try {
      await api.enqueueJob(deckId!, {
        prompt: p,
        kind: mode === 'edit' ? 'edit' : 'create',
        targetKey: mode === 'edit' ? editKey : null,
      });
      setPrompt('');
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }

  async function generateMulti() {
    const topic = prompt.trim();
    if (!topic || generating) return;
    setGenerating(true);
    try {
      const { count: n } = await api.generateSlides(deckId!, {
        topic,
        count,
        afterKey: afterCurrent ? selectedKey : null,
      });
      setPrompt('');
      showToast('success', `Planning & generating ${n} slide${n > 1 ? 's' : ''}…`);
    } catch (e) {
      showToast('error', (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const submit = () => (mode === 'multi' ? void generateMulti() : void enqueue());

  async function cancel(jobId: string) {
    try {
      await api.cancelJob(deckId!, jobId);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  }

  return (
    <div className="fleet-panel" ref={rootRef}>
      <div className="fleet-composer">
        <div className="seg">
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
            ✚ New slide
          </button>
          <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
            ✎ Edit slide
          </button>
          <button className={mode === 'multi' ? 'active' : ''} onClick={() => setMode('multi')}>
            ✦ Multiple
          </button>
        </div>
        {mode === 'edit' && (
          <select value={editKey} onChange={(e) => setEditKey(e.target.value)}>
            {slides.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {mode === 'multi' && (
          <div className="fleet-multi-opts">
            <label>
              Slides
              <input
                type="number"
                min={1}
                max={12}
                value={count}
                onChange={(e) => setCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
              />
            </label>
            <label className="fleet-after">
              <input
                type="checkbox"
                checked={afterCurrent}
                onChange={(e) => setAfterCurrent(e.target.checked)}
              />
              after current slide
            </label>
          </div>
        )}
        <MentionTextarea
          deckId={deckId}
          rows={3}
          placeholder={
            mode === 'create'
              ? 'Describe a new slide to create…  (@ slide/image/video, ⇥ to complete)'
              : mode === 'edit'
                ? 'Describe the change to this slide…  (@ slide/image/video, ⇥ to complete)'
                : 'Topic for a coherent set of slides — AI plans the outline, then builds them in parallel…'
          }
          value={prompt}
          onChange={setPrompt}
          onSubmit={submit}
          getCompletionContext={() => ({
            mode: mode === 'edit' ? 'replace' : 'compose',
            code: mode === 'edit' && model ? findSlide(model, editKey)?.rawHtml : undefined,
          })}
        />
        <div className="fleet-actions">
          {mode === 'multi' ? (
            <button
              className="primary"
              disabled={!prompt.trim() || generating}
              onClick={() => void generateMulti()}
            >
              {generating ? '✦ Planning…' : `✦ Generate ${count} slides  ⌘⏎`}
            </button>
          ) : (
            <button className="primary" disabled={!prompt.trim()} onClick={() => void enqueue()}>
              Enqueue agent  ⌘⏎
            </button>
          )}
          <span className="hint">
            {running}/{AGENT_CONCURRENCY} running{queued ? ` · ${queued} queued` : ''}
          </span>
        </div>
      </div>

      <div className="fleet-list">
        {ordered.length === 0 && (
          <div className="panel-empty small">
            Queue agents to create or edit slides — up to {AGENT_CONCURRENCY} run at once, the rest
            wait their turn. They work in parallel on different slides.
          </div>
        )}
        {ordered.map((job) => {
          const logs = jobLogs[job.id] ?? [];
          const open = expanded[job.id];
          return (
            <div className={`job-card ${job.status}`} key={job.id}>
              <div className="job-head" onClick={() => setExpanded((e) => ({ ...e, [job.id]: !open }))}>
                <span className={`job-dot ${job.status}`} />
                <span className="job-kind">{job.kind === 'create' ? '✚' : '✎'}</span>
                <span className="job-target">{job.kind === 'create' ? 'New slide' : job.targetLabel}</span>
                <span className={`job-status ${job.status}`}>{STATUS_LABEL[job.status]}</span>
              </div>
              <div className="job-prompt">{job.prompt}</div>
              {job.error && <div className="job-error">{job.error}</div>}
              {(job.status === 'queued' || job.status === 'running') && (
                <button className="btn-sm job-cancel" onClick={() => void cancel(job.id)}>
                  Cancel
                </button>
              )}
              {logs.length > 0 && (
                <button
                  className="job-toggle"
                  onClick={() => setExpanded((e) => ({ ...e, [job.id]: !open }))}
                >
                  {open ? 'Hide' : 'Show'} transcript ({logs.length})
                </button>
              )}
              {open && (
                <div className="job-log">
                  {logs.map((l) => (
                    <pre key={l.id} className={`job-log-line ${l.kind}`}>
                      {l.text}
                    </pre>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
