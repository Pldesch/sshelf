import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Slide } from '@studio/shared';
import { useStudio } from '../state/deckStore';
import { slideBackgroundStyle, isSlideHidden } from '../lib/locate';
import { fragmentSteps } from '../lib/fragments';
import { AssetsPanel } from './AssetsPanel';
import { HistoryPanel } from './HistoryPanel';
import { VideoExportModal } from './VideoExportModal';
import { CopyToDeckModal } from './CopyToDeckModal';
import { CopyToThemeModal } from './CopyToThemeModal';
import { SlideMenu, buildSlideMenuItems } from './SlideMenu';
import * as api from '../api/client';

/** Above this many fragment steps, show a count badge instead of one pill per step. */
const MAX_STEP_PILLS = 6;

/**
 * Left-panel tabs. Assets (images + videos) and history are deck-level (not tied to
 * the selected slide), so they live here next to the slide list rather than in the
 * Inspector.
 */
type NavTab = 'slides' | 'assets' | 'history';

/**
 * A navigator entry is one *logical* slide as the audience perceives it.
 * - `single` maps 1:1 to a top-level <section>.
 * - `auto` groups a run of consecutive auto-animate sections: reveal morphs between
 *   them in place, so they read as ONE slide even though they're several <section>s.
 * `keys` is the contiguous block of top-level slide keys the entry owns (used for DnD).
 */
type NavEntry =
  | { kind: 'single'; slide: Slide; keys: string[] }
  | { kind: 'auto'; slides: Slide[]; keys: string[] };

function buildNavEntries(slides: Slide[]): NavEntry[] {
  const entries: NavEntry[] = [];
  let i = 0;
  while (i < slides.length) {
    const s = slides[i];
    // A run of 2+ consecutive auto-animate sections morphs in place and reads as a
    // single slide in the presentation — collapse it into one entry.
    if (s.attrs.autoAnimate && slides[i + 1]?.attrs.autoAnimate) {
      const run: Slide[] = [s];
      let j = i + 1;
      while (j < slides.length && slides[j].attrs.autoAnimate) {
        run.push(slides[j]);
        j += 1;
      }
      entries.push({ kind: 'auto', slides: run, keys: run.map((r) => r.key) });
      i = j;
      continue;
    }
    entries.push({ kind: 'single', slide: s, keys: [s.key] });
    i += 1;
  }
  return entries;
}

export function SlideNavigator({ onCollapse }: { onCollapse?: () => void }) {
  const model = useStudio((s) => s.model);
  const selectedKey = useStudio((s) => s.selectedKey);
  const selectSlide = useStudio((s) => s.selectSlide);
  const previewStepAt = useStudio((s) => s.previewStepAt);
  const currentStep = useStudio((s) => s.currentStep);
  const deckId = useStudio((s) => s.currentDeckId);
  const decks = useStudio((s) => s.decks);
  const showToast = useStudio((s) => s.showToast);
  const jobs = useStudio((s) => s.jobs);

  const openInsertThemeSlide = useStudio((s) => s.openInsertThemeSlide);
  const assetsNonce = useStudio((s) => s.assetsNonce);
  const [navTab, setNavTab] = useState<NavTab>('slides');
  const [exportKey, setExportKey] = useState<string | null>(null);
  const [copyKey, setCopyKey] = useState<string | null>(null);
  const [copyThemeKey, setCopyThemeKey] = useState<string | null>(null);
  // "Copy to deck" only makes sense when there's somewhere else to copy to.
  const canCopyToDeck = decks.length > 1;

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.nav-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  // A command-palette "fetch image/video" request opens the Assets tab.
  useEffect(() => {
    if (assetsNonce > 0) setNavTab('assets');
  }, [assetsNonce]);

  // Fragment-step count per slide (animations within one slide). Memoised because
  // counting parses each slide's HTML.
  const stepsByKey = useMemo(() => {
    const m: Record<string, number> = {};
    if (model) for (const s of model.slides) m[s.key] = fragmentSteps(s.rawHtml);
    return m;
  }, [model]);

  const [dragEntry, setDragEntry] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Any running job with a target marks that slide as "working" — edits and the parallel
  // fills of reserved placeholders from a multi-slide generation.
  const activeKeys = new Set(
    jobs.filter((j) => j.status === 'running' && j.targetKey).map((j) => j.targetKey as string),
  );
  // Only true appends (no target) show the bottom "creating new slide(s)" line; placeholder
  // fills already appear as working rows in the list.
  const creating = jobs.filter((j) => j.status === 'running' && j.kind === 'create' && !j.targetKey).length;

  const add = async (afterKey: string | null) => {
    try {
      await api.addSlide(deckId!, afterKey, model!.contentHash);
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };
  const remove = async (key: string) => {
    try {
      await api.deleteSlide(deckId!, key, model!.contentHash);
      // The pre-delete state is the newest snapshot — offer a one-click undo.
      let undoId: string | undefined;
      try {
        const { snapshots } = await api.listHistory(deckId!);
        undoId = snapshots[0]?.id;
      } catch {
        /* history is best-effort */
      }
      showToast(
        'info',
        'Slide deleted',
        undoId
          ? {
              label: 'Undo',
              run: async () => {
                try {
                  await api.restoreSnapshot(deckId!, undoId as string);
                  showToast('success', 'Slide restored');
                } catch (e) {
                  showToast('error', (e as Error).message);
                }
              },
            }
          : undefined,
      );
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };
  const duplicate = async (key: string) => {
    try {
      const { newKey } = await api.duplicateSlide(deckId!, key, model!.contentHash);
      selectSlide(newKey); // jump to the copy once the watcher refreshes the model
      showToast('success', 'Slide duplicated');
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };
  // Toggle a slide's data-visibility="hidden" — reveal then skips it in the presentation,
  // while it stays here in the sidenav (and editable in the Code tab).
  const toggleHidden = async (key: string, hidden: boolean) => {
    try {
      await api.patchSection(
        deckId!,
        key,
        { 'data-visibility': hidden ? null : 'hidden' },
        model!.contentHash,
      );
    } catch (e) {
      showToast('error', (e as Error).message);
    }
  };

  const entries = model ? buildNavEntries(model.slides) : [];
  const flatKeys = entries.flatMap((e) => e.keys);

  const resetDrag = () => {
    setDragEntry(null);
    setDropIndex(null);
  };
  const onEntryDragOver = (e: DragEvent, index: number) => {
    if (dragEntry == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientY > rect.top + rect.height / 2 ? index + 1 : index);
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const de = dragEntry;
    const di = dropIndex;
    resetDrag();
    if (de == null || di == null) return;
    if (di === de || di === de + 1) return; // dropped back in place
    const order = entries.slice();
    const [moved] = order.splice(de, 1);
    order.splice(di > de ? di - 1 : di, 0, moved);
    const nextKeys = order.flatMap((en) => en.keys);
    if (nextKeys.join('\n') === flatKeys.join('\n')) return;
    try {
      await api.reorderSlides(deckId!, nextKeys, model!.contentHash);
    } catch (err) {
      showToast('error', (err as Error).message);
    }
  };

  let num = 0;
  return (
    <aside className="nav">
      <div className="nav-head">
        <div className="nav-tabs">
          {(['slides', 'assets', 'history'] as const).map((id) => (
            <button
              key={id}
              className={`nav-tab${navTab === id ? ' active' : ''}`}
              onClick={() => setNavTab(id)}
            >
              {id}
            </button>
          ))}
        </div>
        <span className="nav-head-actions">
          {navTab === 'slides' && (
            <button className="icon-btn" title="Add slide at end" onClick={() => add(null)}>
              ＋
            </button>
          )}
          {navTab === 'slides' && (
            <button
              className="icon-btn"
              title="Add a theme slide (⌘I) — insert after the selected slide"
              onClick={() => openInsertThemeSlide(selectedKey ?? null)}
            >
              ❖
            </button>
          )}
          {onCollapse && (
            <button className="icon-btn" title="Collapse panel" onClick={onCollapse}>
              «
            </button>
          )}
        </span>
      </div>
      {navTab === 'assets' ? (
        <AssetsPanel />
      ) : navTab === 'history' ? (
        <HistoryPanel />
      ) : !model ? (
        <div className="nav-empty">Loading…</div>
      ) : (
        <div
          className="nav-list"
          ref={listRef}
          onDragOver={(e) => {
            if (dragEntry != null) e.preventDefault();
          }}
          onDrop={onDrop}
        >
          {entries.map((entry, ei) => {
            const last = ei === entries.length - 1;
            const entryClass = `nav-entry${dragEntry === ei ? ' dragging' : ''}${
              dropIndex === ei ? ' drop-above' : ''
            }${last && dropIndex === entries.length ? ' drop-below' : ''}`;
            const handlers = {
              draggable: true,
              onDragStart: (e: DragEvent) => {
                setDragEntry(ei);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', entry.keys[0]);
              },
              onDragOver: (e: DragEvent) => onEntryDragOver(e, ei),
              onDragEnd: resetDrag,
            };

            if (entry.kind === 'auto') {
              num += 1;
              return (
                <div className={entryClass} key={entry.keys[0]} {...handlers}>
                  <AutoRow
                    steps={entry.slides}
                    deckId={deckId!}
                    index={num}
                    selectedKey={selectedKey}
                    activeKeys={activeKeys}
                    onSelect={selectSlide}
                    onAdd={() => add(entry.keys[entry.keys.length - 1])}
                    onRemove={remove}
                    onExport={() => setExportKey(entry.keys[0])}
                  />
                </div>
              );
            }

            const s = entry.slide;
            const hidden = isSlideHidden(s);
            if (!hidden) num += 1; // hidden slides aren't counted (mirrors the presentation)
            const steps = stepsByKey[s.key] ?? 0;
            const selected = selectedKey === s.key;
            return (
              <div className={entryClass} key={s.key} {...handlers}>
                {steps >= 1 ? (
                  <FragmentRow
                    slide={s}
                    deckId={deckId!}
                    index={num}
                    steps={steps}
                    selected={selected}
                    hidden={hidden}
                    active={activeKeys.has(s.key)}
                    currentStep={selected ? currentStep : null}
                    onSelect={() => selectSlide(s.key)}
                    onStep={(k) => previewStepAt(s.key, k)}
                    onAdd={() => add(s.key)}
                    onDuplicate={() => duplicate(s.key)}
                    onRemove={() => remove(s.key)}
                    onExport={() => setExportKey(s.key)}
                    onToggleHidden={() => toggleHidden(s.key, hidden)}
                    onCopyToDeck={canCopyToDeck ? () => setCopyKey(s.key) : undefined}
                    onCopyToTheme={() => setCopyThemeKey(s.key)}
                  />
                ) : (
                  <NavItem
                    slide={s}
                    deckId={deckId!}
                    index={num}
                    active={activeKeys.has(s.key)}
                    selected={selected}
                    hidden={hidden}
                    onSelect={() => selectSlide(s.key)}
                    onAdd={() => add(s.key)}
                    onDuplicate={() => duplicate(s.key)}
                    onRemove={() => remove(s.key)}
                    onExport={() => setExportKey(s.key)}
                    onToggleHidden={() => toggleHidden(s.key, hidden)}
                    onCopyToDeck={canCopyToDeck ? () => setCopyKey(s.key) : undefined}
                    onCopyToTheme={() => setCopyThemeKey(s.key)}
                  />
                )}
              </div>
            );
          })}
          {creating > 0 && (
            <div className="nav-creating">
              <span className="job-dot running" /> {creating} agent{creating > 1 ? 's' : ''}{' '}
              creating new slide{creating > 1 ? 's' : ''}…
            </div>
          )}
        </div>
      )}
      {exportKey && (
        <VideoExportModal key={exportKey} slideKey={exportKey} onClose={() => setExportKey(null)} />
      )}
      {copyKey && <CopyToDeckModal slideKey={copyKey} onClose={() => setCopyKey(null)} />}
      {copyThemeKey && (
        <CopyToThemeModal slideKey={copyThemeKey} onClose={() => setCopyThemeKey(null)} />
      )}
    </aside>
  );
}

interface NavItemProps {
  slide: Slide;
  deckId: string;
  index: number;
  selected: boolean;
  active?: boolean;
  hidden?: boolean;
  onSelect: () => void;
  onAdd?: () => void;
  onDuplicate?: () => void;
  onCopyToDeck?: () => void;
  onCopyToTheme?: () => void;
  onRemove?: () => void;
  onExport?: () => void;
  onToggleHidden?: () => void;
}

function NavItem({ slide, deckId, index, selected, active, hidden, onSelect, onAdd, onDuplicate, onCopyToDeck, onCopyToTheme, onRemove, onExport, onToggleHidden }: NavItemProps) {
  return (
    <div
      className={`nav-item${selected ? ' selected' : ''}${active ? ' active-job' : ''}${hidden ? ' hidden' : ''}`}
      onClick={onSelect}
    >
      <span className="nav-num">{hidden ? '–' : index}</span>
      <span className="nav-swatch" style={slideBackgroundStyle(slide, deckId)} />
      <span className="nav-title">{slide.title || slide.id || '(untitled)'}</span>
      {active && <span className="job-dot running nav-working" title="an agent is editing this slide" />}
      {(onAdd || onDuplicate || onCopyToDeck || onCopyToTheme || onRemove || onExport || onToggleHidden) && (
        <SlideMenu
          items={buildSlideMenuItems({
            hidden,
            onToggleHidden,
            onAdd,
            onDuplicate,
            onExport,
            onCopyToDeck,
            onCopyToTheme,
            onRemove,
          })}
        />
      )}
    </div>
  );
}

interface AutoRowProps {
  steps: Slide[];
  deckId: string;
  index: number;
  selectedKey: string | null;
  activeKeys: Set<string>;
  onSelect: (key: string) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onExport: () => void;
}

/**
 * One row for an auto-animate sequence (a single logical slide that morphs through
 * its steps in the presentation). Each step stays individually selectable/editable
 * via the numbered pills, but the run counts as one slide in the navigator.
 */
function AutoRow({ steps, deckId, index, selectedKey, activeKeys, onSelect, onAdd, onRemove, onExport }: AutoRowProps) {
  const selectedIdx = steps.findIndex((s) => s.key === selectedKey);
  const selected = selectedIdx >= 0;
  const activeIdx = selected ? selectedIdx : 0;
  const working = steps.some((s) => activeKeys.has(s.key));
  const shown = steps[activeIdx];
  return (
    <div
      className={`nav-item auto-row${selected ? ' selected' : ''}${working ? ' active-job' : ''}`}
      onClick={() => onSelect(shown.key)}
    >
      <span className="nav-num">{index}</span>
      <span className="nav-swatch" style={slideBackgroundStyle(shown, deckId)} />
      <span className="nav-title">{shown.title || shown.id || 'Auto-Animate'}</span>
      <span
        className="auto-steps"
        title={`Auto-animate sequence — one slide that morphs through ${steps.length} steps`}
      >
        <span className="auto-icon">⟳</span>
        {steps.map((st, k) => (
          <button
            key={st.key}
            className={`auto-step${selected && k === activeIdx ? ' on' : ''}`}
            title={`Edit step ${k + 1} of ${steps.length}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(st.key);
            }}
          >
            {k + 1}
          </button>
        ))}
      </span>
      {working && <span className="job-dot running nav-working" title="an agent is editing this slide" />}
      <SlideMenu
        items={buildSlideMenuItems({
          onExport,
          onAdd,
          onRemove: () => onRemove(shown.key),
          removeLabel: `Delete step ${activeIdx + 1}`,
        })}
      />
    </div>
  );
}

interface FragmentRowProps {
  slide: Slide;
  deckId: string;
  index: number;
  steps: number;
  selected: boolean;
  active?: boolean;
  hidden?: boolean;
  currentStep: number | null;
  onSelect: () => void;
  onStep: (step: number) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onCopyToDeck?: () => void;
  onCopyToTheme?: () => void;
  onRemove: () => void;
  onExport: () => void;
  onToggleHidden: () => void;
}

/**
 * One row for a slide that animates its own elements with fragments. It's a single
 * slide (one row), but the numbered pills expose each animation step — selecting the
 * slide shows it fully revealed, clicking a pill scrubs the preview to that step.
 */
function FragmentRow({
  slide,
  deckId,
  index,
  steps,
  selected,
  active,
  hidden,
  currentStep,
  onSelect,
  onStep,
  onAdd,
  onDuplicate,
  onCopyToDeck,
  onCopyToTheme,
  onRemove,
  onExport,
  onToggleHidden,
}: FragmentRowProps) {
  // Which pill is "current": the preview's actual step (clamped — chart slides can
  // advance past the static step count), defaulting to fully-revealed (the last pill).
  const activeStep = !selected ? -1 : Math.min(steps, currentStep ?? steps);
  const showPills = steps <= MAX_STEP_PILLS;
  return (
    <div
      className={`nav-item frag-row${selected ? ' selected' : ''}${active ? ' active-job' : ''}${hidden ? ' hidden' : ''}`}
      onClick={onSelect}
    >
      <span className="nav-num">{hidden ? '–' : index}</span>
      <span className="nav-swatch" style={slideBackgroundStyle(slide, deckId)} />
      <span className="nav-title">{slide.title || slide.id || '(untitled)'}</span>
      <span
        className="auto-steps"
        title={`${steps} animation step${steps > 1 ? 's' : ''} — click a number to preview that step`}
      >
        <span className="auto-icon">✦</span>
        {showPills ? (
          Array.from({ length: steps }, (_, k) => k + 1).map((k) => (
            <button
              key={k}
              className={`auto-step${k === activeStep ? ' on' : ''}`}
              title={k === steps ? 'Preview fully revealed' : `Preview step ${k} of ${steps}`}
              // The last pill means "fully revealed" (incl. chart reveals beyond the
              // static fragment count); earlier pills scrub to that partial step.
              onClick={(e) => {
                e.stopPropagation();
                if (k === steps) onSelect();
                else onStep(k);
              }}
            >
              {k}
            </button>
          ))
        ) : (
          <span className="auto-count">{steps}</span>
        )}
      </span>
      {active && <span className="job-dot running nav-working" title="an agent is editing this slide" />}
      <SlideMenu
        items={buildSlideMenuItems({
          hidden,
          onToggleHidden,
          onAdd,
          onDuplicate,
          onExport,
          onCopyToDeck,
          onCopyToTheme,
          onRemove,
        })}
      />
    </div>
  );
}
