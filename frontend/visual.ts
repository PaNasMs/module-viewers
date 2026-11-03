import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { parseFragment } from "parse5";
import { marked } from "marked";
import { t } from "./strings";
const tags = new Set(
  "p br h1 h2 h3 h4 h5 h6 strong b i em s del u a ul ol li blockquote pre code hr".split(
    " ",
  ),
);
type Node = {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
};
function safe(node: Node): boolean {
  return (
    (!node.tagName
      ? ["#document-fragment", "#text"].includes(node.nodeName)
      : tags.has(node.tagName) &&
        (node.attrs ?? []).every(
          (a) =>
            (node.tagName === "a" &&
              a.name === "href" &&
              !/^\s*(?:javascript|data|vbscript):/i.test(a.value)) ||
            (node.tagName === "ol" &&
              a.name === "start" &&
              /^\d+$/.test(a.value)),
        )) && (node.childNodes ?? []).every(safe)
  );
}
export function visualSource(text: string, md: boolean) {
  if (md) {
    const tokens = marked.lexer(text);
    let ok = true;
    marked.walkTokens(tokens, (tok) => {
      if (
        ["html", "image", "table", "def"].includes(tok.type) ||
        ("task" in tok && tok.task)
      )
        ok = false;
    });
    if (!ok || Object.keys(tokens.links).length || /^---\r?\n/.test(text))
      throw Error(t("unsupported"));
    return { body: text, wrap: (s: string) => s };
  }
  const match = /^([\s\S]*?<body\b[^>]*>)([\s\S]*)(<\/body\s*>[\s\S]*)$/i.exec(
    text,
  );
  const body = match ? match[2] : text;
  if (
    !safe(parseFragment(body)) ||
    (!match && /<(?:!doctype|html\b|head\b|body\b)/i.test(text))
  )
    throw Error(t("unsupported"));
  return { body, wrap: (s: string) => (match ? match[1] + s + match[3] : s) };
}
export function mountVisual(
  el: HTMLElement,
  value: string,
  md: boolean,
  change: (s: string) => void,
) {
  const { body, wrap } = visualSource(value, md);
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: false, linkOnPaste: false },
      }),
      Markdown,
    ],
    content: body,
    contentType: md ? "markdown" : "html",
    editorProps: {
      attributes: {
        "aria-label": t("visual"),
        role: "textbox",
        "aria-multiline": "true",
      },
      handlePaste: (_view, e) => {
        const text = e.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        e.preventDefault();
        _view.dispatch(_view.state.tr.insertText(text));
        return true;
      },
      handleDrop: () => true,
    },
    onUpdate: ({ editor }) =>
      change(wrap(md ? editor.getMarkdown() : editor.getHTML())),
  });
}
