import { Icon, Button } from "@panasms/ui";
import { mdiArrowLeft, mdiDownloadOutline } from "@mdi/js";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { content, read } from "./io";
import { kind, type Props } from "./types";
import { t } from "./strings";
import { ImageView } from "./image";
const Editor = lazy(() => import("./editor"));
const Documents = lazy(() => import("./documents"));
export default function Workspace(p: Props) {
  const [entry] = useState(p.entry),
    k = kind(entry.name);
  const [blob, B] = useState<Blob>(),
    [error, E] = useState(""),
    [retry, R] = useState(0);
  const guard = useRef<null | (() => boolean)>(null);
  useEffect(() => {
    const c = new AbortController();
    E("");
    B(undefined);
    read(
      entry,
      (k === "text" ? 4 : k === "djvu" || k === "image" ? 48 : 96) * 1048576,
      c.signal,
    )
      .then((b) => {
        if (!c.signal.aborted) B(b);
      })
      .catch((e) => {
        if (!c.signal.aborted) E(e.message);
      });
    return () => c.abort();
  }, [entry, k, retry]);
  return (
    <section className="vw panel">
      <header className="vw-header">
        <Button
          className="vw-header-action"
          title={t("back")}
          aria-label={t("back")}
          type="button"
          onClick={() => {
            if (!guard.current || guard.current()) p.close();
          }}
        >
          <Icon path={mdiArrowLeft} size={20} />
          <span>{t("folder")}</span>
        </Button>
        <h1>{entry.name}</h1>
        <a
          className="button vw-header-action"
          data-tooltip={t("download")}
          aria-label={t("download")}
          href={content(entry)}
          download={entry.name}
        >
          <Icon path={mdiDownloadOutline} size={20} />
          <span>{t("get")}</span>
        </a>
      </header>
      {error ? (
        <p role="alert">
          {error} <button onClick={() => R((x) => x + 1)}>{t("retry")}</button>
        </p>
      ) : !blob ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <Suspense fallback={<p role="status">{t("loading")}</p>}>
          {k === "image" ? (
            <ImageView {...p} entry={entry} blob={blob} />
          ) : k === "text" ? (
            <Editor {...p} entry={entry} blob={blob} guard={guard} />
          ) : (
            <Documents blob={blob} kind={k} />
          )}
        </Suspense>
      )}
    </section>
  );
}
