import * as React from "react"
import { Mark, mergeAttributes } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

export interface SlideTextRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SlideTextVisualStyle {
  color: string
  fontFamily: string
  fontFeatureSettings: string
  fontKerning: React.CSSProperties["fontKerning"]
  fontOpticalSizing: React.CSSProperties["fontOpticalSizing"]
  fontSize: string
  fontStyle: string
  fontStretch: string
  fontVariant: string
  fontVariationSettings: string
  fontWeight: string
  letterSpacing: string
  lineHeight: string
  paddingBottom: string
  paddingLeft: string
  paddingRight: string
  paddingTop: string
  textAlign: React.CSSProperties["textAlign"]
  textDecoration: string
  textRendering: React.CSSProperties["textRendering"]
  textTransform: React.CSSProperties["textTransform"]
  whiteSpace: React.CSSProperties["whiteSpace"]
  wordSpacing: string
}

const EDITOR_TYPOGRAPHY_STYLE = [
  "color: inherit",
  "font: inherit",
  "font-feature-settings: inherit",
  "font-kerning: inherit",
  "font-optical-sizing: inherit",
  "font-stretch: inherit",
  "font-variant: inherit",
  "font-variation-settings: inherit",
  "letter-spacing: inherit",
  "line-height: inherit",
  "text-align: inherit",
  "text-decoration: inherit",
  "text-rendering: inherit",
  "text-transform: inherit",
  "white-space: inherit",
  "word-spacing: inherit",
  "margin: 0",
  "min-height: 100%",
  "padding: 0",
  "outline: none",
].join("; ")

const InlineDocument = Document.extend({ content: "inline*" })
const StyledSpan = Mark.create({
  name: "slideSpan",
  addAttributes() {
    return {
      class: { default: null },
      style: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: "span" }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0]
  },
})

const extensions = [
  InlineDocument,
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    codeBlock: false,
    document: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    paragraph: false,
    trailingNode: false,
  }),
  StyledSpan,
]

export function SlideTextOverlay({
  html,
  rect,
  visualStyle,
  onChange,
  onFinish,
}: {
  html: string
  rect: SlideTextRect
  visualStyle: SlideTextVisualStyle
  onChange: (html: string) => void
  onFinish: (html: string) => void
}) {
  const onChangeRef = React.useRef(onChange)
  const onFinishRef = React.useRef(onFinish)
  const finishingRef = React.useRef(false)
  onChangeRef.current = onChange
  onFinishRef.current = onFinish

  const editor = useEditor({
    extensions,
    content: html,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": "Edit slide text",
        style: EDITOR_TYPOGRAPHY_STYLE,
      },
    },
    onUpdate: ({ editor: currentEditor }) =>
      onChangeRef.current(currentEditor.getHTML()),
  })

  React.useEffect(() => {
    if (editor) editor.commands.focus("end", { scrollIntoView: false })
  }, [editor])

  function finish(nextHtml: string) {
    if (finishingRef.current) return
    finishingRef.current = true
    onFinishRef.current(nextHtml)
  }

  return (
    <div
      data-slide-text-editor
      className="absolute z-20 box-border rounded-sm bg-transparent outline-2 outline-offset-4 outline-blue-600/70"
      style={{
        left: rect.x,
        top: rect.y,
        width: Math.max(rect.width, 24),
        minHeight: Math.max(rect.height, 20),
        ...visualStyle,
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          finish(editor?.getHTML() ?? html)
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
