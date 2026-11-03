import { OfficePackage, S, R, elements, child } from "./office-package";
import { t } from "./strings";

export function columnName(n: number): string {
  let name = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
export function position(ref: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref.toUpperCase());
  if (!match) return;
  const col = Array.from(match[1]).reduce(
      (n, c) => 26 * n + c.charCodeAt(0) - 64,
      0,
    ),
    row = +match[2];
  if (col <= 16384 && row <= 1048576) return { row, col };
}
function range(ref: string) {
  const [first, last = first] = ref.split(":");
  const a = position(first),
    b = position(last);
  return a && b ? { a, b } : undefined;
}
function textValue(node?: Element) {
  return node
    ? Array.from(node.children)
        .map((e) =>
          e.localName === "t"
            ? e.textContent
            : e.localName === "r"
              ? child(e, "t")?.textContent
              : "",
        )
        .join("")
        .replace(/_x([0-9a-f]{4})_/gi, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
    : "";
}
export async function openBook(pkg: OfficePackage) {
  const main = "xl/workbook.xml",
    workbook = await pkg.xml(main);
  const rels = await pkg.relationships(main);
  const sheets = elements(workbook, S, "sheet")
    .filter(
      (s) => !["hidden", "veryHidden"].includes(s.getAttribute("state") ?? ""),
    )
    .flatMap((s) => {
      const rel = rels.get(s.getAttributeNS(R, "id")!);
      return rel?.type === R + "/worksheet"
        ? [{ name: s.getAttribute("name")!, path: rel.path }]
        : [];
    });
  if (!sheets.length) throw Error(t("decode"));
  const sharedPath = [...rels.values()].find(
    (r) => r.type === R + "/sharedStrings",
  )?.path;
  const shared = sharedPath ? elements(await pkg.xml(sharedPath), S, "si") : [];
  const locked =
    pkg.signed ||
    elements(workbook, S, "workbookProtection").length > 0 ||
    elements(workbook, S, "fileSharing").length > 0;
  const cache = new Map<string, Awaited<ReturnType<typeof load>>>();
  async function load(path: string) {
    const xml = await pkg.xml(path),
      data = elements(xml, S, "sheetData")[0];
    if (!data) throw Error(t("decode"));
    const rows = new Map<number, Element>(),
      cells = new Map<string, Element>();
    const spans: NonNullable<ReturnType<typeof range>>[] = [];
    let implicit = false;
    for (const row of Array.from(data.children)) {
      rows.set(Number(row.getAttribute("r")), row);
      for (const c of Array.from(row.children)) {
        if (c.localName !== "c") continue;
        const ref = c.getAttribute("r");
        if (!ref || !position(ref) || cells.has(ref)) {
          implicit = true;
          continue;
        }
        cells.set(ref, c);
        const bounds = range(child(c, "f")?.getAttribute("ref") ?? "");
        if (bounds) spans.push(bounds);
      }
    }
    for (const m of elements(xml, S, "mergeCell")) {
      const bounds = range(m.getAttribute("ref") ?? "");
      if (bounds) spans.push(bounds);
    }
    if (implicit) throw Error(t("sheetLayout"));
    const guarded =
      locked ||
      elements(xml, S, "sheetProtection").length > 0 ||
      elements(xml, S, "tableParts").length > 0 ||
      spans.length > 4096;
    function get(ref: string) {
      const c = cells.get(ref),
        v = c && child(c, "v"),
        type = c?.getAttribute("t") ?? "n",
        f = c && child(c, "f");
      const str =
        type === "s" ? shared[Number(v?.textContent)] : c && child(c, "is");
      const p = position(ref)!;
      const special = spans.some(
        ({ a, b }) =>
          p.row >= a.row && p.row <= b.row && p.col >= a.col && p.col <= b.col,
      );
      const value = f
        ? "=" + (f.textContent || v?.textContent || "…")
        : str
          ? textValue(str)
          : type === "b"
            ? v?.textContent === "1"
              ? "TRUE"
              : "FALSE"
            : (v?.textContent ?? "");
      return {
        value,
        readonly:
          guarded ||
          special ||
          !!f ||
          (!!str && !!child(str, "r")) ||
          !["s", "inlineStr", "n", "b"].includes(type) ||
          (!!c && ["cm", "vm"].some((a) => c.hasAttribute(a))),
        type,
      };
    }
    function set(ref: string, value: string) {
      if (get(ref).readonly) throw Error(t("readonly"));
      const p = position(ref)!;
      let row = rows.get(p.row),
        cell = cells.get(ref);
      if (!row) {
        row = xml.createElementNS(S, "row");
        row.setAttribute("r", String(p.row));
        data.insertBefore(
          row,
          Array.from(data.children).find(
            (e) => Number(e.getAttribute("r")) > p.row,
          ) ?? null,
        );
        rows.set(p.row, row);
      }
      if (!cell) {
        cell = xml.createElementNS(S, "c");
        cell.setAttribute("r", ref);
        row.insertBefore(
          cell,
          Array.from(row.children).find(
            (e) =>
              e.localName !== "c" ||
              (position(e.getAttribute("r")!)?.col ?? 0) > p.col,
          ) ?? null,
        );
        cells.set(ref, cell);
      }
      const type = cell.getAttribute("t"),
        wasBlank = !child(cell, "v") && !child(cell, "is");
      child(cell, "v")?.remove();
      child(cell, "is")?.remove();
      cell.removeAttribute("t");
      if (value) {
        const numeric =
          (wasBlank || !type || type === "n") &&
          /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) &&
          Number.isFinite(Number(value));
        const bool = type === "b" && /^(true|false)$/i.test(value);
        const node = xml.createElementNS(S, numeric || bool ? "v" : "is");
        if (numeric || bool) {
          if (bool) cell.setAttribute("t", "b");
          node.textContent = bool
            ? String(Number(value.toLowerCase() === "true"))
            : value;
        } else {
          cell.setAttribute("t", "inlineStr");
          const text = xml.createElementNS(S, "t");
          text.setAttributeNS(
            "http://www.w3.org/XML/1998/namespace",
            "xml:space",
            "preserve",
          );
          text.textContent = value
            .replace(/_x(?=[0-9a-f]{4}_)/gi, "_x005F_x")
            .replace(
              /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
              (c) => "_x" + c.charCodeAt(0).toString(16).padStart(4, "0") + "_",
            );
          node.append(text);
        }
        cell.insertBefore(node, child(cell, "extLst") ?? null);
      }
      const dim = child(xml.documentElement, "dimension");
      if (dim) {
        const bounds = range(dim.getAttribute("ref") ?? "A1");
        if (bounds)
          dim.setAttribute(
            "ref",
            columnName(Math.min(bounds.a.col, p.col)) +
              Math.min(bounds.a.row, p.row) +
              ":" +
              columnName(Math.max(bounds.b.col, p.col)) +
              Math.max(bounds.b.row, p.row),
          );
      }
      row.removeAttribute("spans");
      pkg.set(path, xml);
    }
    return { get, set, guarded };
  }
  async function sheet(path: string) {
    if (!cache.has(path)) cache.set(path, await load(path));
    return cache.get(path)!;
  }
  async function save(changes: Map<string, Map<string, string>>) {
    for (const [path, edits] of changes) {
      const ws = await sheet(path);
      for (const [ref, value] of edits) ws.set(ref, value);
    }
    let calc = child(workbook.documentElement, "calcPr");
    if (!calc) {
      calc = workbook.createElementNS(S, "calcPr");
      workbook.documentElement.insertBefore(
        calc,
        Array.from(workbook.documentElement.children).find((e) =>
          [
            "oleSize",
            "customWorkbookViews",
            "pivotCaches",
            "smartTagPr",
            "smartTagTypes",
            "webPublishing",
            "fileRecoveryPr",
            "webPublishObjects",
            "extLst",
          ].includes(e.localName),
        ) ?? null,
      );
    }
    calc.setAttribute("fullCalcOnLoad", "1");
    pkg.set(main, workbook);
  }
  return { sheets, sheet, save };
}
