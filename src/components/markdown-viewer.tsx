import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Link } from "@tanstack/react-router"
import { parentOf, rawFileUrl } from "@/lib/file-kinds"

function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")
}

function resolveRelative(baseDir: string, href: string): string {
  const stack = baseDir ? baseDir.split("/") : []
  for (const segment of href.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") stack.pop()
    else stack.push(segment)
  }
  return stack.join("/")
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [
  [
    rehypeHighlight,
    {
      detect: true,
      subset: [
        "javascript",
        "typescript",
        "python",
        "bash",
        "json",
        "yaml",
        "markdown",
        "xml",
        "css",
        "sql",
      ],
    },
  ],
] as never[]

/** Notes often carry YAML frontmatter — metadata, not prose. Drop it. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "")
}

export default function MarkdownViewer({
  path,
  content,
}: {
  path: string
  content: string
}) {
  const baseDir = parentOf(path)
  const body = stripFrontmatter(content)
  return (
    <article className="prose max-w-none prose-stone prose-headings:text-[var(--navy-700)] prose-a:font-medium prose-a:text-[var(--navy-600)] prose-blockquote:border-l-[var(--orange-300)] prose-blockquote:font-normal prose-code:rounded prose-code:bg-[var(--stone-100)] prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:bg-[var(--navy-800)] prose-pre:text-[var(--navy-100)] prose-th:text-[var(--navy-700)] prose-hr:border-[var(--stone-200)]">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={{
          a: ({ href, children }) => {
            if (!href || isExternal(href)) {
              return (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            }
            const [pathPart] = href.split("#")
            if (!pathPart) return <a href={href}>{children}</a>
            return (
              <Link
                to="/$"
                params={{
                  _splat: resolveRelative(baseDir, decodeURI(pathPart)),
                }}
              >
                {children}
              </Link>
            )
          },
          img: ({ src, alt }) => {
            const source =
              typeof src === "string" && !isExternal(src)
                ? rawFileUrl(resolveRelative(baseDir, decodeURI(src)))
                : src
            return (
              <img
                src={typeof source === "string" ? source : undefined}
                alt={alt ?? ""}
                loading="lazy"
                className="rounded-lg shadow-sm"
              />
            )
          },
          // Code inside a navy pre block needs the inline-code chip
          // styling stripped (prose-code sets a light background).
          pre: ({ children }) => (
            <pre className="not-prose overflow-x-auto rounded-lg bg-[var(--navy-800)] p-5 font-mono text-[13px] leading-relaxed text-[var(--navy-100)]">
              {children}
            </pre>
          ),
        }}
      >
        {body}
      </Markdown>
    </article>
  )
}
