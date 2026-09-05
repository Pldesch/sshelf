export interface GhostCompleterOpts {
  /** Fetch a continuation for the prompt (deck- or theme-scoped); '' when none. */
  complete: (
    req: { prompt: string; mode: 'compose' | 'replace'; code?: string },
    signal: AbortSignal,
  ) => Promise<string>;
  /** Context for the suggestion: edit-mode and the current slide source. */
  getContext: () => { mode: 'compose' | 'replace'; code?: string };
  /** Called with the suggestion (or '' to clear). `forValue` is the prompt text the
   *  suggestion was computed for — callers drop it if the field has since changed. */
  onSuggestion: (text: string, forValue: string) => void;
  debounceMs?: number;
  minChars?: number;
}

/**
 * Debounced, abortable fetcher for SI prompt ghost-text. Each `schedule(value)` cancels
 * any in-flight request and, after a short pause, asks the server for a continuation —
 * dropping the result if `value` is no longer current. Framework-agnostic so both the
 * React textarea and the imperative ⌘K input can share it.
 */
export function createGhostCompleter(opts: GhostCompleterOpts) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctrl: AbortController | null = null;
  let lastValue = '';

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    ctrl?.abort();
    ctrl = null;
  };

  const schedule = (value: string) => {
    cancel();
    lastValue = value;
    if (value.trim().length < (opts.minChars ?? 3)) {
      opts.onSuggestion('', value);
      return;
    }
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      const { mode, code } = opts.getContext();
      try {
        const completion = await opts.complete({ prompt: value, mode, code }, ctrl.signal);
        if (value === lastValue) opts.onSuggestion(completion ?? '', value);
      } catch {
        /* aborted or failed — leave the suggestion cleared */
      }
    }, opts.debounceMs ?? 180);
  };

  return { schedule, cancel };
}
