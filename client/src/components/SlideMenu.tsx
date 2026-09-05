import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SlideMenuItem {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Build the standard slide-action menu items from whichever callbacks are provided. */
export function buildSlideMenuItems(o: {
  hidden?: boolean;
  onToggleHidden?: () => void;
  onAdd?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  onCopyToDeck?: () => void;
  onCopyToTheme?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}): SlideMenuItem[] {
  const items: SlideMenuItem[] = [];
  if (o.onToggleHidden)
    items.push({
      icon: o.hidden ? '🙈' : '👁',
      label: o.hidden ? 'Show in presentation' : 'Hide from presentation',
      onClick: o.onToggleHidden,
    });
  if (o.onAdd) items.push({ icon: '＋', label: 'Add slide after', onClick: o.onAdd });
  if (o.onDuplicate) items.push({ icon: '⧉', label: 'Duplicate slide', onClick: o.onDuplicate });
  if (o.onExport) items.push({ icon: '🎬', label: 'Export as video', onClick: o.onExport });
  if (o.onCopyToDeck) items.push({ icon: '📋', label: 'Copy to another deck', onClick: o.onCopyToDeck });
  if (o.onCopyToTheme) items.push({ icon: '◐', label: 'Copy to theme', onClick: o.onCopyToTheme });
  if (o.onRemove)
    items.push({ icon: '🗑', label: o.removeLabel ?? 'Delete slide', onClick: o.onRemove, danger: true });
  return items;
}

/**
 * A "⋯" trigger that opens a labeled dropdown of slide actions. The menu is rendered in a
 * portal with fixed positioning anchored to the trigger, so the navigator's scroll overflow
 * can't clip it. Closes on outside click, Escape, scroll, or resize.
 */
interface MenuPos {
  top?: number;
  bottom?: number;
  right: number;
}

export function SlideMenu({ items, title = 'Slide actions' }: { items: SlideMenuItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Place the menu under the trigger, but flip ABOVE it when there isn't room below
  // (so the actions stay on-screen for slides near the bottom of the list). The menu is
  // rendered hidden first so we can measure its real height before committing a position.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const gap = 4;
    const margin = 8;
    const menuH = menuRef.current?.offsetHeight ?? items.length * 34 + 16;
    const right = Math.round(window.innerWidth - b.right);
    const spaceBelow = window.innerHeight - b.bottom;
    const flipUp = spaceBelow < menuH + gap + margin && b.top > spaceBelow;
    setPos(
      flipUp
        ? { bottom: Math.round(window.innerHeight - b.top + gap), right }
        : { top: Math.round(b.bottom + gap), right },
    );
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  return (
    <span className="nav-menu">
      <button
        ref={btnRef}
        className={`icon-btn slide-menu-trigger${open ? ' open' : ''}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="slide-menu-pop"
            role="menu"
            style={
              pos
                ? { top: pos.top, bottom: pos.bottom, right: pos.right }
                : { top: 0, right: 0, visibility: 'hidden' }
            }
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                className={`slide-menu-item${it.danger ? ' danger' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span className="smi-icon">{it.icon}</span>
                <span className="smi-label">{it.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
