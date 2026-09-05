import { CodeEditor } from './CodeEditor';
import { StyleEditor } from './StyleEditor';
import { ColorPanel } from './ColorPanel';
import { ThemePanel } from './ThemePanel';
import { AnimationPanel } from './AnimationPanel';
import { FleetPanel } from './FleetPanel';
import { useStudio } from '../state/deckStore';

const TABS = [
  { id: 'code', label: 'Code' },
  { id: 'styles', label: 'Styles' },
  { id: 'colors', label: 'Colors' },
  { id: 'theme', label: 'Theme' },
  { id: 'animate', label: 'Animation' },
  { id: 'ai', label: 'Agents' },
] as const;

export function Inspector() {
  const tab = useStudio((s) => s.inspectorTab);
  const setTab = useStudio((s) => s.setInspectorTab);
  const activeJobs = useStudio((s) =>
    s.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length,
  );
  return (
    <aside className="inspector">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'ai' && activeJobs > 0 && <span className="tab-badge">{activeJobs}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'code' && <CodeEditor />}
        {tab === 'styles' && <StyleEditor />}
        {tab === 'colors' && <ColorPanel />}
        {tab === 'theme' && <ThemePanel />}
        {tab === 'animate' && <AnimationPanel />}
        {tab === 'ai' && <FleetPanel />}
      </div>
    </aside>
  );
}
