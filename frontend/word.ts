import { Editor, Extension, Mark, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { OfficePackage, W, R, PR, child, elements } from "./office-package";
import { t } from "./strings";

const val = (node?: Element) => node?.getAttributeNS(W, "val") ?? "";
const on = (node?: Element) =>
  !!node && !["off", "0", "false"].includes(val(node));
function word(doc: Document, name: string, value?: string) {
  const node = doc.createElementNS(W, "w:" + name);
  if (value !== undefined) node.setAttributeNS(W, "w:val", value);
  return node;
}
function supported(node: Element, names: string[]) {
  return Array.from(node.children).every(
    (e) => e.namespaceURI === W && names.includes(e.localName),
  );
}
const paragraphSource = Extension.create({
  name: "paragraphSource",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: { source: { default: null, renderHTML: () => ({}) } },
      },
    ];
  },
});
const runSource = Mark.create({
  name: "wordRun",
  inclusive: true,
  addAttributes() {
    return { source: { default: null } };
  },
  renderHTML() {
    return ["span", 0];
  },
});
export async function openWord(pkg: OfficePackage) {
  const main = "word/document.xml",
    doc = await pkg.xml(main),
    body = elements(doc, W, "body")[0];
  const rels = await pkg.relationships(main);
  const part = (type: string) =>
    [...rels.values()].find((r) => r.type === R + "/" + type)?.path;
  const settings = part("settings");
  function unavailable(): never {
    throw Error(t("officeComplex"));
  }
  if (!body || pkg.signed || !supported(body, ["p", "sectPr"])) unavailable();
  if (settings) {
    const cfg = await pkg.xml(settings);
    if (
      ["documentProtection", "writeProtection", "trackRevisions"].some(
        (n) => elements(cfg, W, n).length,
      )
    )
      unavailable();
  }
  const paras = Array.from(body.children).filter((e) => e.localName === "p");
  const runs: Element[] = [];
  const numberingPath = part("numbering") || "word/numbering.xml";
  const numbering = pkg.parts.has(numberingPath)
    ? await pkg.xml(numberingPath)
    : document.implementation.createDocument(W, "w:numbering");
  const numberingType = new Map<string, string>();
  for (const num of elements(numbering, W, "num")) {
    const id = val(child(num, "abstractNumId"));
    const def = elements(numbering, W, "abstractNum").find(
      (n) => n.getAttributeNS(W, "abstractNumId") === id,
    );
    const fmt =
      def && child(def, "lvl") && val(child(child(def, "lvl")!, "numFmt"));
    if (fmt) numberingType.set(num.getAttributeNS(W, "numId")!, fmt);
  }
  const blocks: JSONContent[] = [];
  const originals = new Map<Element, { block: JSONContent; list?: string }>();
  function signature(block: JSONContent) {
    return JSON.stringify([
      block.type,
      block.attrs?.level,
      (block.content ?? []).map((s) => [
        s.text,
        (s.marks ?? []).map((m) => [m.type, m.attrs?.source]).sort(),
      ]),
    ]);
  }
  for (const [index, p] of paras.entries()) {
    if (
      !supported(p, ["pPr", "r"]) ||
      elements(p, W, "sectPr").length ||
      elements(p, W, "pPrChange").length
    )
      unavailable();
    const pr = child(p, "pPr"),
      style = pr && val(child(pr, "pStyle"));
    const heading = /^Heading([1-6])$/i.exec(style || "");
    const block: JSONContent = {
      type: heading ? "heading" : "paragraph",
      attrs: { source: index, ...(heading ? { level: +heading[1] } : {}) },
      content: [],
    };
    for (const r of Array.from(p.children).filter((e) => e.localName === "r")) {
      if (!supported(r, ["rPr", "t"]) || elements(r, W, "rPrChange").length)
        unavailable();
      const text = elements(r, W, "t")
        .map((e) => e.textContent)
        .join("");
      if (!text) continue;
      const rp = child(r, "rPr"),
        marks: NonNullable<JSONContent["marks"]> = [
          { type: "wordRun", attrs: { source: runs.length } },
        ];
      runs.push(r);
      if (rp && on(child(rp, "b"))) marks.push({ type: "bold" });
      if (rp && on(child(rp, "i"))) marks.push({ type: "italic" });
      block.content!.push({ type: "text", text, marks });
    }
    const numPr = pr && child(pr, "numPr"),
      num = numPr && val(child(numPr, "numId"));
    if (num && num !== "0") {
      if (heading || Number(val(child(numPr!, "ilvl"))) !== 0) unavailable();
      const fmt = numberingType.get(num);
      if (!fmt) unavailable();
      const type = fmt === "bullet" ? "bulletList" : "orderedList";
      originals.set(p, { block, list: type });
      const list = blocks.at(-1);
      const item = { type: "listItem", content: [block] };
      if (list?.type === type && list.attrs?.num === num)
        list.content!.push(item);
      else blocks.push({ type, attrs: { num }, content: [item] });
    } else {
      originals.set(p, { block });
      blocks.push(block);
    }
  }
  const initial: JSONContent = {
    type: "doc",
    content: blocks.length ? blocks : [{ type: "paragraph" }],
  };
  const createdLists = new Map<string, string>();
  async function registerPart(type: string, file: string) {
    if (part(type)) return;
    const path = "word/_rels/document.xml.rels";
    const xml =
      pkg.parts.has(path) || pkg.changed.has(path)
        ? await pkg.xml(path)
        : document.implementation.createDocument(PR, "Relationships");
    const link = xml.createElementNS(PR, "Relationship");
    let rid = "rIdViewer";
    while (
      Array.from(xml.documentElement.children).some(
        (e) => e.getAttribute("Id") === rid,
      )
    )
      rid += "1";
    link.setAttribute("Id", rid);
    link.setAttribute("Type", R + "/" + type);
    link.setAttribute("Target", file);
    xml.documentElement.append(link);
    pkg.set(path, xml);
    const ct = await pkg.xml("[Content_Types].xml");
    const override = ct.createElementNS(
      ct.documentElement.namespaceURI,
      "Override",
    );
    override.setAttribute(
      "ContentType",
      "application/vnd.openxmlformats-officedocument.wordprocessingml." +
        type +
        "+xml",
    );
    override.setAttribute("PartName", "/word/" + file);
    ct.documentElement.append(override);
    pkg.set("[Content_Types].xml", ct);
    rels.set(rid, { type: R + "/" + type, path: "word/" + file });
  }

  async function ensureHeading(level: number) {
    const path = part("styles") ?? "word/styles.xml";
    const styles =
      pkg.parts.has(path) || pkg.changed.has(path)
        ? await pkg.xml(path)
        : document.implementation.createDocument(W, "w:styles");
    const id = "Heading" + level;
    if (
      elements(styles, W, "style").some(
        (s) => s.getAttributeNS(W, "styleId") === id,
      )
    )
      return;
    const style = word(styles, "style");
    style.setAttributeNS(W, "w:type", "paragraph");
    style.setAttributeNS(W, "w:styleId", id);
    const pr = word(styles, "pPr");
    pr.append(
      word(styles, "keepNext"),
      word(styles, "outlineLvl", String(level - 1)),
    );
    const rp = word(styles, "rPr");
    rp.append(word(styles, "b"), word(styles, "sz", String(36 - level * 2)));
    style.append(word(styles, "name", "heading " + level), pr, rp);
    styles.documentElement.append(style);
    pkg.set(path, styles);
    await registerPart("styles", "styles.xml");
  }
  async function listId(type: string) {
    if (createdLists.has(type)) return createdLists.get(type)!;
    const next = (tag: string, attr: string) =>
      String(
        Math.max(
          0,
          ...elements(numbering, W, tag).map(
            (e) => Number(e.getAttributeNS(W, attr)) || 0,
          ),
        ) + 1,
      );
    const aid = next("abstractNum", "abstractNumId"),
      id = next("num", "numId");
    const abstract = word(numbering, "abstractNum");
    abstract.setAttributeNS(W, "w:abstractNumId", aid);
    for (let depth = 0; depth < 9; depth++) {
      const level = word(numbering, "lvl");
      level.setAttributeNS(W, "w:ilvl", String(depth));
      level.append(
        word(numbering, "start", "1"),
        word(numbering, "numFmt", type === "bulletList" ? "bullet" : "decimal"),
        word(
          numbering,
          "lvlText",
          type === "bulletList" ? "•" : "%" + (depth + 1) + ".",
        ),
      );
      const pr = word(numbering, "pPr"),
        indent = word(numbering, "ind");
      indent.setAttributeNS(W, "w:left", String(720 * (depth + 1)));
      indent.setAttributeNS(W, "w:hanging", "360");
      pr.append(indent);
      level.append(pr);
      abstract.append(level);
    }
    numbering.documentElement.insertBefore(
      abstract,
      elements(numbering, W, "num")[0] ?? null,
    );
    const n = word(numbering, "num");
    n.setAttributeNS(W, "w:numId", id);
    n.append(word(numbering, "abstractNumId", aid));
    numbering.documentElement.append(n);
    pkg.set(numberingPath, numbering);
    await registerPart("numbering", "numbering.xml");
    createdLists.set(type, id);
    return id;
  }
  async function save(tree: JSONContent) {
    const fragment = doc.createDocumentFragment();
    const used = new Set<Element>();
    async function emit(block: JSONContent, list?: string, depth = -1) {
      if (
        block.type === "doc" ||
        block.type === "listItem" ||
        block.type === "bulletList" ||
        block.type === "orderedList"
      ) {
        const isList = block.type.endsWith("List");
        for (const node of block.content ?? [])
          await emit(node, isList ? block.type : list, depth + Number(isList));
        return;
      }
      if (!["paragraph", "heading"].includes(block.type!)) unavailable();
      const origin = paras[block.attrs?.source],
        p = origin ? (origin.cloneNode(false) as Element) : word(doc, "p");
      const original = originals.get(origin);
      if (
        origin &&
        !used.has(origin) &&
        original?.list === list &&
        depth < 1 &&
        original &&
        signature(block) === signature(original.block)
      ) {
        used.add(origin);
        fragment.append(origin.cloneNode(true));
        return;
      }
      if (used.has(origin))
        for (const a of Array.from(p.attributes))
          if (["paraId", "textId"].includes(a.localName))
            p.removeAttributeNode(a);
      if (origin) used.add(origin);
      const originalPr = origin && child(origin, "pPr");
      const pr = originalPr
        ? (originalPr.cloneNode(true) as Element)
        : word(doc, "pPr");
      const style = child(pr, "pStyle");
      if (block.type === "heading") {
        const name = "Heading" + block.attrs?.level;
        if (val(style) !== name) {
          await ensureHeading(block.attrs!.level);
          style?.remove();
          pr.prepend(word(doc, "pStyle", name));
        }
      } else if (/^Heading[1-6]$/i.test(val(style))) style?.remove();
      const np = child(pr, "numPr"),
        oldNum = np && val(child(np, "numId"));
      if (list) {
        if (
          depth > 0 ||
          !oldNum ||
          (numberingType.get(oldNum) === "bullet") !== (list === "bulletList")
        ) {
          np?.remove();
          const n = word(doc, "numPr");
          n.append(
            word(doc, "ilvl", String(Math.min(8, depth))),
            word(doc, "numId", await listId(list)),
          );
          pr.insertBefore(
            n,
            Array.from(pr.children).find(
              (e) =>
                ![
                  "pStyle",
                  "keepNext",
                  "keepLines",
                  "pageBreakBefore",
                  "framePr",
                  "widowControl",
                ].includes(e.localName),
            ) ?? null,
          );
        }
      } else np?.remove();
      if (pr.children.length) p.append(pr);
      for (const span of block.content ?? []) {
        if (span.type !== "text") unavailable();
        const marks = span.marks ?? [],
          run = runs[marks.find((m) => m.type === "wordRun")?.attrs?.source];
        const r = word(doc, "r"),
          original = run && child(run, "rPr");
        const rp = original
          ? (original.cloneNode(true) as Element)
          : word(doc, "rPr");
        for (const [tag, mark] of [
          ["b", "bold"],
          ["i", "italic"],
        ]) {
          const existing = child(rp, tag),
            active = marks.some((m) => m.type === mark);
          if (active !== on(existing)) {
            existing?.remove();
            rp.append(word(doc, tag, active ? "1" : "0"));
          }
        }
        if (rp.children.length) r.append(rp);
        const text = word(doc, "t");
        text.setAttributeNS(
          "http://www.w3.org/XML/1998/namespace",
          "xml:space",
          "preserve",
        );
        text.textContent = span.text ?? "";
        r.append(text);
        p.append(r);
      }
      fragment.append(p);
    }
    await emit(tree);
    const section = child(body, "sectPr");
    body.replaceChildren(fragment, ...(section ? [section] : []));
    pkg.set(main, doc);
  }
  return { initial, save };
}
export function mountWord(
  element: HTMLElement,
  content: JSONContent,
  update: () => void,
) {
  return new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        hardBreak: false,
        horizontalRule: false,
        link: false,
        strike: false,
        underline: false,
        listKeymap: false,
      }),
      paragraphSource,
      runSource,
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": t("visual"),
        "aria-multiline": "true",
      },
      handlePaste: (view, e) => {
        e.preventDefault();
        view.dispatch(
          view.state.tr.insertText(
            e.clipboardData?.getData("text/plain") ?? "",
          ),
        );
        return true;
      },
      handleDrop: () => true,
    },
    onUpdate: update,
  });
}
