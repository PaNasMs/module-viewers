import * as Dialog from "@radix-ui/react-dialog";
import { Button, DialogContent } from "@panasms/ui";
import { Toolbar } from "./toolbar";
import {
  mdiContentSaveOutline,
  mdiDownloadOutline,
  mdiMagnify,
  mdiWrap,
  mdiFormatIndentIncrease,
  mdiFileEditOutline,
  mdiCodeTags,
  mdiFormatBold,
  mdiFormatItalic,
  mdiFormatHeader2,
  mdiFormatListBulleted,
  mdiUndo,
  mdiRedo,
} from "@mdi/js";
import { useEffect, useRef, useState, type RefObject } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { openSearchPanel } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Editor as Rich } from "@tiptap/core";
import { useQueryClient } from "@tanstack/react-query";
import { locale } from "@panasms/i18n";
import { content, writeFile } from "./io";
import { t } from "./strings";
import { ext, type Props } from "./types";
import { parsers, beautify } from "./format";
const drafts = new WeakMap<
  object,
  Map<string, { value: string; revision?: string }>
>();
export default function Editor(
  props: Props & { blob: Blob; guard: RefObject<null | (() => boolean)> },
) {
  const { entry, blob, readOnly, guard } = props;
  const cache = useQueryClient()
    .getQueryCache()
    .find({ queryKey: ["session"], exact: true });
  const [draftMap] = useState(() => {
    if (!cache) return new Map<string, { value: string; revision?: string }>();
    if (!drafts.has(cache)) drafts.set(cache, new Map());
    return drafts.get(cache)!;
  });
  const [draft] = useState(() => draftMap.get(entry.path));
  const [value, V] = useState(""),
    [base, Q] = useState(""),
    [ready, L] = useState(false),
    [eol, NL] = useState("\n"),
    [bom, BM] = useState(false),
    [mixed, MX] = useState(false);
  const [err, E] = useState(""),
    [visual, G] = useState(false),
    [discard, H] = useState(false),
    [busy, B] = useState(false),
    [wrap, W] = useState(true),
    [cursor, C] = useState("1:1");
  const name = entry.name,
    x = ext(name),
    md = x === "md" || x === "markdown",
    richOK = md || x === "html" || x === "htm",
    dirty = ready && value !== base;
  const revision = draft?.revision ?? entry.revision,
    locked = readOnly || !revision || mixed;
  const el = useRef<HTMLDivElement>(null),
    cm = useRef<EditorView | null>(null),
    rich = useRef<Rich | null>(null);
  const current = useRef(value);
  current.current = value;
  const modified = (s: string) => {
    current.current = s;
    V(s);
    if (s === base) draftMap.delete(entry.path);
    else draftMap.set(entry.path, { value: s, revision });
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const src = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (src.includes("\0")) throw Error();
      if (!alive) return;
      const ends = new Set(src.match(/\r\n|\r|\n/g) ?? []);
      MX(ends.size > 1);
      NL([...ends][0] ?? "\n");
      BM(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191);
      const normalized = src.replace(/\r\n?/g, "\n");
      Q(normalized);
      V(draft?.value ?? normalized);
      L(true);
    })().catch(() => {
      if (alive) E(t("binary"));
    });
    return () => {
      alive = false;
    };
  }, [blob]);
  useEffect(() => {
    guard.current = () => {
      if (busy) return false;
      if (dirty) {
        H(true);
        return false;
      }
      return true;
    };
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", before);
    return () => {
      guard.current = null;
      window.removeEventListener("beforeunload", before);
    };
  }, [dirty, busy]);
  const lineWrap = useRef(new Compartment()).current,
    theme = useRef(new Compartment()).current;
  useEffect(() => {
    if (!ready || visual || !el.current) return;
    const lang = new Compartment();
    const dark = () =>
      document.documentElement.dataset.theme === "dark" ? oneDark : [];
    const langCode = locale().slice(0, 2),
      ru = langCode === "ru";
    const phrases =
      langCode === "en"
        ? {}
        : Object.fromEntries(
            Object.entries({
              Find: ru ? "Найти" : "Знайти",
              Replace: ru ? "Заменить" : "Замінити",
              "Replace all": ru ? "Заменить все" : "Замінити всі",
              next: ru ? "далее" : "далі",
              previous: ru ? "назад" : "назад",
              all: ru ? "все" : "усі",
              "match case": ru ? "учитывать регистр" : "враховувати регістр",
              "by word": ru ? "целое слово" : "ціле слово",
              regexp: ru ? "регулярное выражение" : "регулярний вираз",
              replace: ru ? "заменить" : "замінити",
              "replace all": ru ? "заменить все" : "замінити всі",
              close: ru ? "закрыть" : "закрити",
            }),
          );
    const view = new EditorView({
      parent: el.current,
      state: EditorState.create({
        doc: current.current,
        extensions: [
          basicSetup,
          EditorState.phrases.of(phrases),
          EditorView.contentAttributes.of({ "aria-label": t("source") }),
          EditorState.readOnly.of(locked),
          EditorView.editable.of(!locked),
          lang.of([]),
          lineWrap.of(wrap ? EditorView.lineWrapping : []),
          theme.of(dark()),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) modified(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const pos = u.state.selection.main.head,
                line = u.state.doc.lineAt(pos);
              C(line.number + ":" + String(pos - line.from + 1));
            }
          }),
        ],
      }),
    });
    cm.current = view;
    const desc = LanguageDescription.matchFilename(languages, name);
    let active = true;
    if (desc)
      void desc
        .load()
        .then((s) => {
          if (active) view.dispatch({ effects: lang.reconfigure(s) });
        })
        .catch(() => {});
    const obs = new MutationObserver(() =>
      view.dispatch({ effects: theme.reconfigure(dark()) }),
    );
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      active = false;
      obs.disconnect();
      cm.current = null;
      view.destroy();
    };
  }, [ready, visual, locked]);
  useEffect(() => {
    cm.current?.dispatch({
      effects: lineWrap.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);
  useEffect(() => {
    if (!visual || !el.current) return;
    let alive = true;
    void import("./visual")
      .then((m) => {
        if (alive && el.current)
          rich.current = m.mountVisual(
            el.current,
            current.current,
            md,
            modified,
          );
      })
      .catch((e) => {
        if (alive) {
          E(e.message);
          G(false);
        }
      });
    return () => {
      alive = false;
      rich.current?.destroy();
      rich.current = null;
    };
  }, [visual]);
  function bytes() {
    return new Blob(
      [
        bom ? new Uint8Array([239, 187, 191]) : "",
        current.current.replace(/\n/g, eol),
      ],
      { type: "text/plain;charset=utf-8" },
    );
  }
  const saving = useRef(false);
  async function save() {
    if (locked || !dirty || busy || saving.current) return;
    saving.current = true;
    B(true);
    E("");
    try {
      const data = bytes();
      if (data.size > 4 * 1048576) throw Error(t("limit"));
      await writeFile(
        content(entry) + "&replace_revision=" + encodeURIComponent(revision!),
        data,
      );
      draftMap.delete(entry.path);
      window.dispatchEvent(
        new CustomEvent("panasms:toast", { detail: t("saved") }),
      );
      await props.saved();
    } catch (e) {
      E((e as Error).message || t("conflict"));
    } finally {
      B(false);
      saving.current = false;
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function format() {
    const before = current.current;
    E("");
    try {
      const after = await beautify(before, parsers[x]);
      if (current.current === before && cm.current)
        cm.current.dispatch({
          changes: { from: 0, to: cm.current.state.doc.length, insert: after },
        });
    } catch (e) {
      E((e as Error).message);
    }
  }
  function backup() {
    const u = URL.createObjectURL(bytes()),
      a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <>
      {err && (
        <p className="vw-message" role="alert">
          {err}
        </p>
      )}
      {!ready ? (
        !err && <p role="status">{t("loading")}</p>
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
                    disabled: locked || !dirty || busy,
                    run: () => void save(),
                  },
                  ...(dirty
                    ? [
                        {
                          label: t("export"),
                          icon: mdiDownloadOutline,
                          run: backup,
                        },
                      ]
                    : []),
                ],
              },
              {
                commands: visual
                  ? []
                  : [
                      {
                        label: t("find"),
                        icon: mdiMagnify,
                        run: () => {
                          if (cm.current) openSearchPanel(cm.current);
                        },
                      },
                      {
                        label: t("wrap"),
                        icon: mdiWrap,
                        pressed: wrap,
                        run: () => W(!wrap),
                      },
                      ...(parsers[x] && !locked
                        ? [
                            {
                              label: t("format"),
                              icon: mdiFormatIndentIncrease,
                              run: () => void format(),
                            },
                          ]
                        : []),
                    ],
              },
              {
                commands:
                  richOK && !locked
                    ? [
                        {
                          label: t(visual ? "source" : "visual"),
                          icon: visual ? mdiCodeTags : mdiFileEditOutline,
                          run: () => {
                            E("");
                            G(!visual);
                          },
                        },
                      ]
                    : [],
              },
              {
                commands: visual
                  ? (
                      [
                        [
                          "bold",
                          mdiFormatBold,
                          () =>
                            rich.current?.chain().focus().toggleBold().run(),
                        ],
                        [
                          "italic",
                          mdiFormatItalic,
                          () =>
                            rich.current?.chain().focus().toggleItalic().run(),
                        ],
                        [
                          "heading",
                          mdiFormatHeader2,
                          () =>
                            rich.current
                              ?.chain()
                              .focus()
                              .toggleHeading({ level: 2 })
                              .run(),
                        ],
                        [
                          "list",
                          mdiFormatListBulleted,
                          () =>
                            rich.current
                              ?.chain()
                              .focus()
                              .toggleBulletList()
                              .run(),
                        ],
                        [
                          "undo",
                          mdiUndo,
                          () => rich.current?.chain().focus().undo().run(),
                        ],
                        [
                          "redo",
                          mdiRedo,
                          () => rich.current?.chain().focus().redo().run(),
                        ],
                      ] as const
                    ).map(([key, icon, run]) => ({ label: t(key), icon, run }))
                  : [],
              },
            ]}
          />
          {visual && <p>{t("loss")}</p>}
          {draft && <p>{t("draft")}</p>}
          {discard && (
            <Dialog.Root
              open
              onOpenChange={(open) => {
                if (!open) H(false);
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
                      <Dialog.Description>{name}</Dialog.Description>
                    </>
                  }
                  footer={
                    <div className="dialog-actions">
                      <Button data-dialog-cancel onClick={() => H(false)}>
                        {t("keep")}
                      </Button>
                      <Button
                        className="danger"
                        onClick={() => {
                          draftMap.delete(entry.path);
                          props.close();
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
          <div
            inert={busy || discard}
            className={visual ? "vw-rich" : "vw-code"}
            key={String(visual)}
            ref={el}
          />
          <footer>
            {x || t("plain")} · UTF-8{bom ? " BOM" : ""} ·{" "}
            {mixed
              ? "Mixed EOL"
              : eol === "\r\n"
                ? "CRLF"
                : eol === "\r"
                  ? "CR"
                  : "LF"}{" "}
            · {t("position")} {cursor}{" "}
            {locked ? " · " + t("readonly") : dirty ? " · " + t("changed") : ""}
          </footer>
        </>
      )}
    </>
  );
}
