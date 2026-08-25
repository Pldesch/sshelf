import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import ini from "highlight.js/lib/languages/ini"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { memo, useMemo } from "react"
import { extensionOf } from "@/lib/file-kinds"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("css", css)
hljs.registerLanguage("ini", ini)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("python", python)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("yaml", yaml)

const EXT_LANGUAGE: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  env: "ini",
  toml: "ini",
  ini: "ini",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonl: "json",
  md: "markdown",
  py: "python",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  html: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  yml: "yaml",
  yaml: "yaml",
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function TextViewer({ path, content }: { path: string; content: string }) {
  const language = EXT_LANGUAGE[extensionOf(path)]
  const html = useMemo(
    () =>
      language && hljs.getLanguage(language)
        ? hljs.highlight(content, { language, ignoreIllegals: true }).value
        : escapeHtml(content),
    [content, language]
  )
  return (
    <pre className="overflow-x-auto rounded-lg bg-[var(--navy-800)] p-5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--navy-100)]">
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

export default memo(TextViewer)
