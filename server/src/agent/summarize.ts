/** Turn a Claude Code stream-json event into a short transcript line. */
export function summarizeAgentEvent(ev: any): { kind: string; text: string } | null {
  if (!ev || typeof ev !== 'object') return null;

  if (ev.type === 'system' && ev.subtype === 'init') {
    return { kind: 'system', text: `Session started · model ${ev.model ?? '?'}` };
  }

  if (ev.type === 'assistant' && ev.message?.content) {
    const parts: string[] = [];
    for (const c of ev.message.content) {
      if (c.type === 'text' && c.text?.trim()) parts.push(c.text.trim());
      else if (c.type === 'tool_use') parts.push(`▸ ${c.name} ${describeTool(c)}`.trim());
    }
    const text = parts.join('\n');
    return text ? { kind: 'assistant', text } : null;
  }

  return null;
}

function describeTool(c: any): string {
  const input = c.input ?? {};
  switch (c.name) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return input.file_path ? String(input.file_path).split('/').pop() ?? '' : '';
    case 'Bash':
      return input.command ? truncate(String(input.command), 60) : '';
    case 'Skill':
      return input.command ?? input.skill ?? '';
    default:
      return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
