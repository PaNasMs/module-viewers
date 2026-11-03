import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { Button, DialogContent } from "@panasms/ui";
import * as Dialog from "@radix-ui/react-dialog";
import {
  mdiContentSaveOutline,
  mdiDownloadOutline,
  mdiFormatBold,
  mdiFormatItalic,
  mdiFormatHeader2,
  mdiFormatListBulleted,
  mdiUndo,
  mdiRedo,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiChevronDown,
} from "@mdi/js";
import { useQueryClient } from "@tanstack/react-query";
import { Toolbar } from "./toolbar";
import Documents from "./documents";
import { OfficePackage } from "./office-package";
import { openWord, mountWord } from "./word";
import { openBook, columnName, position } from "./sheet";
import type { Props } from "./types";
import { t } from "./strings";
import { content, writeFile } from "./io";

type Format = "docx" | "xlsx" | "pptx";
type OfficeProps = Props & {
  blob: Blob;
  format: Format;
  guard: RefObject<null | (() => boolean)>;
};
type Book = Awaited<ReturnType<typeof openBook>>;
type Edits = Map<string, Map<string, string>>;
type Draft = { tree?: JSONContent; edits: Edits };
const sessions = new WeakMap<object, Map<string, Draft>>();
function OfficePreview({ blob, format }: { blob: Blob; format: Format }) {
  const [pdf, setPdf] = useState<Blob>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setPdf(undefined);
    fetch("/api/v1/module-api/viewers/render?format=" + format + "&page=1", {
      method: "POST",
      body: blob,
      headers: { "X-PaNasMs-Request": "1" },
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error(t(r.status === 429 ? "busy" : "decode"));
        const result = await r.blob();
        if (!abort.signal.aborted) setPdf(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [blob, format, retry]);
  return pdf ? (
    <Documents blob={pdf} kind="pdf" slides={format === "pptx"} />
  ) : error ? (
    <p role="alert">
      {error} <Button onClick={() => setRetry(retry + 1)}>{t("retry")}</Button>
    </p>
  ) : (
    <p role="status">{t("loading")}</p>
  );
}
function Grid({
  book,
  edits,
  locked,
  onChange,
}: {
  book: Book;
  edits: Edits;
  locked: boolean;
  onChange: (
    path: string,
    ref: string,
    value: string,
    original: string,
  ) => void;
}) {
  const [path, choose] = useState(book.sheets[0].path),
    [sheet, setSheet] = useState<Awaited<ReturnType<Book["sheet"]>>>(),
    [err, setErr] = useState("");
  const [start, move] = useState({ row: 1, col: 1 }),
    [address, setAddress] = useState("A1");
  const grid = useRef<HTMLTableElement>(null);
  useEffect(() => {
    let live = true;
    setSheet(undefined);
    setErr("");
    book
      .sheet(path)
      .then((s) => {
        if (live) setSheet(s);
      })
      .catch((e) => {
        if (live) setErr(e.message);
      });
    return () => {
      live = false;
    };
  }, [book, path]);
  const height = 20,
    width = 8;
  function jump(row: number, col: number) {
    move({ row, col });
    setAddress(columnName(col) + row);
  }
  const rows = Array.from(
    { length: Math.min(height, 1048577 - start.row) },
    (_, i) => i + start.row,
  );
  const cols = Array.from(
    { length: Math.min(width, 16385 - start.col) },
    (_, i) => i + start.col,
  );
  return (
    <>
      <div className="vw-sheet-nav">
        <label>
          {t("sheet")}{" "}
          <select
            value={path}
            onChange={(e) => {
              setSheet(undefined);
              choose(e.target.value);
              jump(1, 1);
            }}
          >
            {book.sheets.map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = position(address);
            if (p) {
              jump(p.row, p.col);
              requestAnimationFrame(() =>
                grid.current?.querySelector("input")?.focus(),
              );
            }
          }}
        >
          <label>
            {t("goCell")}{" "}
            <input
              value={address}
              required
              pattern="[A-Za-z]{1,3}[1-9][0-9]{0,6}"
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
        </form>
        <Toolbar
          groups={[
            {
              primary: true,
              commands: [
                {
                  label: t("prevCols"),
                  icon: mdiChevronLeft,
                  disabled: start.col === 1,
                  run: () => jump(start.row, Math.max(1, start.col - width)),
                },
                {
                  label: t("nextCols"),
                  icon: mdiChevronRight,
                  disabled: start.col + width > 16384,
                  run: () => jump(start.row, start.col + width),
                },
                {
                  label: t("prevRows"),
                  icon: mdiChevronUp,
                  disabled: start.row === 1,
                  run: () => jump(Math.max(1, start.row - height), start.col),
                },
                {
                  label: t("nextRows"),
                  icon: mdiChevronDown,
                  disabled: start.row + height > 1048576,
                  run: () => jump(start.row + height, start.col),
                },
              ],
            },
          ]}
        />
      </div>
      {err ? (
        <p role="alert">{err}</p>
      ) : !sheet ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <div className="vw-grid-wrap">
            <table
              className="vw-grid"
              ref={grid}
              aria-label={book.sheets.find((s) => s.path === path)?.name}
            >
              <thead>
                <tr>
                  <th></th>
                  {cols.map((c) => (
                    <th scope="col" key={c}>
                      {columnName(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row}>
                    <th scope="row">{row}</th>
                    {cols.map((col) => {
                      const ref = columnName(col) + row,
                        cell = sheet.get(ref);
                      return (
                        <td key={col}>
                          <input
                            aria-label={ref}
                            readOnly={locked || cell.readonly}
                            maxLength={32767}
                            value={edits.get(path)?.get(ref) ?? cell.value}
                            onChange={(e) =>
                              onChange(path, ref, e.target.value, cell.value)
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer>
            {sheet.guarded || locked ? t("readonly") : t("sheetHint")}
          </footer>
        </>
      )}
    </>
  );
}
export default function Office(p: OfficeProps) {
  const { blob, format, entry, guard } = p;
  const cache = useQueryClient()
    .getQueryCache()
    .find({ queryKey: ["session"], exact: true });
  const [drafts] = useState(() => {
    if (!cache) return new Map<string, Draft>();
    if (!sessions.has(cache)) sessions.set(cache, new Map());
    return sessions.get(cache)!;
  });
  const key = JSON.stringify([entry.path, entry.revision]),
    [draft] = useState(() => drafts.get(key));
  const [word, setWord] = useState<Awaited<ReturnType<typeof openWord>>>(),
    [book, setBook] = useState<Book>(),
    [preview, setPreview] = useState(format === "pptx"),
    [reason, setReason] = useState("");
  const [dirty, setDirty] = useState(!!draft),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  const [edits, setEdits] = useState<Edits>(draft?.edits ?? new Map());
  const element = useRef<HTMLDivElement>(null),
    editor = useRef<Editor | null>(null),
    saving = useRef(false);
  const locked = p.readOnly || !entry.revision;
  const copyOnly = blob.size > 4 * 1048576;
  useEffect(() => {
    if (format === "pptx") return;
    let live = true;
    (async () => {
      const pkg = await OfficePackage.open(blob);
      if (format === "docx") {
        if (locked) {
          if (live) {
            setReason(t("readonly"));
            setPreview(true);
          }
          return;
        }
        const model = await openWord(pkg);
        if (live) setWord(model);
      } else {
        const model = await openBook(pkg);
        if (live) setBook(model);
      }
    })().catch((e) => {
      if (live) {
        if (format === "docx") {
          setReason(e.message);
          setPreview(true);
        } else setError(e.message);
      }
    });
    return () => {
      live = false;
    };
  }, [blob, format, locked]);
  useEffect(() => {
    if (!word || !element.current) return;
    const e = mountWord(element.current, draft?.tree ?? word.initial, () => {
      const tree = e.getJSON();
      drafts.set(key, { tree, edits: new Map() });
      setDirty(true);
    });
    editor.current = e;
    return () => {
      e.destroy();
      editor.current = null;
    };
  }, [word]);
  function change(path: string, ref: string, value: string, original: string) {
    const next = new Map(edits),
      cells = new Map(next.get(path));
    if (value === original) cells.delete(ref);
    else cells.set(ref, value);
    if (cells.size) next.set(path, cells);
    else next.delete(path);
    setEdits(next);
    setDirty(!!next.size);
    if (next.size) drafts.set(key, { edits: next });
    else drafts.delete(key);
  }
  async function publish(download: boolean) {
    if (locked || !dirty || saving.current || (!download && copyOnly)) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const pkg = await OfficePackage.open(blob);
      if (format === "docx")
        await (await openWord(pkg)).save(editor.current!.getJSON());
      else await (await openBook(pkg)).save(edits);
      const bytes = await pkg.pack();
      if (download) {
        const url = URL.createObjectURL(bytes),
          a = document.createElement("a");
        a.href = url;
        a.download = entry.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return;
      }
      if (bytes.size > 4 * 1048576) throw Error(t("officeCopy"));
      await writeFile(
        content(entry) +
          "&replace_revision=" +
          encodeURIComponent(entry.revision!),
        bytes,
      );
      drafts.delete(key);
      setDirty(false);
      window.dispatchEvent(
        new CustomEvent("panasms:toast", { detail: t("saved") }),
      );
      await p.saved();
    } catch (e) {
      setError((e as Error).message || t("conflict"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    guard.current = () => {
      if (saving.current) return false;
      if (dirty) setDiscard(true);
      return !dirty;
    };
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const shortcut = (e: KeyboardEvent) => {
      if (!preview && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void publish(copyOnly);
      }
    };
    if (dirty) window.addEventListener("beforeunload", unload);
    window.addEventListener("keydown", shortcut);
    return () => {
      guard.current = null;
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("keydown", shortcut);
    };
  });
  if (preview)
    return (
      <>
        {reason && <p role="status">{reason}</p>}
        <OfficePreview blob={blob} format={format} />
      </>
    );
  const cmd = (label: string, icon: string, run: () => void) => ({
    keepSelection: true,
    label: t(label),
    icon,
    run,
    disabled: locked || busy,
  });
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!word && !book ? (
        !error && <p role="status">{t("loading")}</p>
      ) : (
        <>
          <Toolbar
            groups={[
              {
                primary: true,
                commands: [
                  {
                    label: t(busy ? "saving" : "save"),
                    icon: mdiContentSaveOutline,
                    run: () => void publish(false),
                    disabled: busy || locked || copyOnly || !dirty,
                  },
                  {
                    label: t("export"),
                    icon: mdiDownloadOutline,
                    run: () => void publish(true),
                    disabled: busy || locked || !dirty,
                  },
                ],
              },
              {
                commands: word
                  ? [
                      cmd("bold", mdiFormatBold, () =>
                        editor.current?.chain().focus().toggleBold().run(),
                      ),
                      cmd("italic", mdiFormatItalic, () =>
                        editor.current?.chain().focus().toggleItalic().run(),
                      ),
                      cmd("heading", mdiFormatHeader2, () =>
                        editor.current
                          ?.chain()
                          .focus()
                          .toggleHeading({ level: 2 })
                          .run(),
                      ),
                      cmd("list", mdiFormatListBulleted, () =>
                        editor.current
                          ?.chain()
                          .focus()
                          .toggleBulletList()
                          .run(),
                      ),
                      cmd("undo", mdiUndo, () =>
                        editor.current?.chain().focus().undo().run(),
                      ),
                      cmd("redo", mdiRedo, () =>
                        editor.current?.chain().focus().redo().run(),
                      ),
                    ]
                  : [],
              },
            ]}
          />
          {copyOnly && !locked && <p role="status">{t("officeCopy")}</p>}
          {word ? (
            <>
              <div
                inert={busy || discard}
                className="vw-rich vw-word"
                ref={element}
              />
              <footer>DOCX{dirty ? " · " + t("changed") : ""}</footer>
            </>
          ) : (
            book && (
              <div className="vw-workbook" inert={busy || discard}>
                <Grid
                  book={book}
                  edits={edits}
                  locked={locked}
                  onChange={change}
                />
              </div>
            )
          )}
        </>
      )}
      {discard && (
        <Dialog.Root
          open
          onOpenChange={(v) => {
            if (!v) setDiscard(false);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <DialogContent
              className="settings-dialog"
              variant="compact"
              intent="confirm"
              header={
                <>
                  <Dialog.Title>{t("warning")}</Dialog.Title>
                  <Dialog.Description>{entry.name}</Dialog.Description>
                </>
              }
              footer={
                <div className="dialog-actions">
                  <Button data-dialog-cancel onClick={() => setDiscard(false)}>
                    {t("keep")}
                  </Button>
                  <Button
                    className="danger"
                    onClick={() => {
                      drafts.delete(key);
                      p.close();
                    }}
                  >
                    {t("discard")}
                  </Button>
                </div>
              }
            />
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
