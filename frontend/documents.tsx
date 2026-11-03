import { Toolbar } from "./toolbar";
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiFitToScreenOutline,
} from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { asset } from "./types";
import { decode } from "./io";
import { t } from "./strings";
export default function Documents({
  blob,
  kind,
}: {
  blob: Blob;
  kind: string;
}) {
  const [page, P] = useState(1),
    [pages, N] = useState(0),
    [scale, Z] = useState(1),
    [pdf, D] = useState<PDFDocumentProxy>(),
    [image, I] = useState(""),
    [error, E] = useState(""),
    [busy, B] = useState(true),
    [retry, R] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null),
    area = useRef<HTMLDivElement>(null);
  const [width, W] = useState(800);
  useEffect(() => {
    const a = area.current!;
    const obs = new ResizeObserver(() => W(Math.max(200, a.clientWidth - 24)));
    obs.observe(a);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (kind !== "pdf") return;
    let alive = true,
      task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    (async () => {
      const lib = await import("pdfjs-dist");
      lib.GlobalWorkerOptions.workerSrc = asset + "pdf.worker.min.mjs";
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!alive) return;
      task = lib.getDocument({
        data,
        useWasm: false,
        disableFontFace: true,
        standardFontDataUrl: asset + "fonts/",
        cMapUrl: asset + "cmaps/",
        cMapPacked: true,
        wasmUrl: asset + "wasm/",
      });
      const doc = await task.promise;
      if (alive) {
        D(doc);
        N(doc.numPages);
      }
    })().catch(() => {
      if (alive) {
        E(t("decode"));
        B(false);
      }
    });
    return () => {
      alive = false;
      if (task) void task.destroy();
    };
  }, [kind, blob, retry]);
  useEffect(() => {
    if (kind === "pdf" && !pdf) return;
    const c = new AbortController();
    let url = "",
      render:
        | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
        | undefined;
    B(true);
    E("");
    (async () => {
      if (kind === "pdf" && pdf) {
        const p = await pdf.getPage(page);
        if (c.signal.aborted) return;
        const v = p.getViewport({ scale: 1 }),
          factor = Math.min(
            3,
            (scale * width) / v.width,
            3200 / Math.max(v.height, v.width),
          );
        const viewport = p.getViewport({ scale: factor });
        const el = canvas.current!;
        el.width = Math.ceil(viewport.width);
        el.height = Math.ceil(viewport.height);
        render = p.render({ canvas: el, viewport });
        await render.promise;
      } else {
        const r = await decode(blob, "djvu", page, c.signal);
        if (c.signal.aborted) return;
        url = URL.createObjectURL(r.blob);
        I(url);
        N(r.pages);
      }
      if (!c.signal.aborted) B(false);
    })().catch((e) => {
      if (!c.signal.aborted) {
        E(e.message || t("decode"));
        B(false);
      }
    });
    return () => {
      c.abort();
      render?.cancel();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    kind,
    pdf,
    blob,
    page,
    kind === "pdf" ? scale : 0,
    kind === "pdf" ? width : 0,
    retry,
  ]);
  return (
    <>
      <Toolbar
        groups={[
          {
            primary: true,
            between: (
              <label className="vw-count">
                {" "}
                <input
                  key={page}
                  aria-label={t("page")}
                  type="number"
                  min={1}
                  max={pages || 1}
                  defaultValue={page}
                  onBlur={(e) => {
                    const n = +e.target.value;
                    if (Number.isInteger(n) && n >= 1 && n <= pages) P(n);
                    else e.target.value = String(page);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />{" "}
                / {pages || "…"}
              </label>
            ),
            commands:
              pages > 1
                ? [
                    {
                      label: t("prev"),
                      icon: mdiChevronLeft,
                      disabled: page <= 1,
                      run: () => P(page - 1),
                    },
                    {
                      label: t("next"),
                      icon: mdiChevronRight,
                      disabled: page >= pages,
                      run: () => P(page + 1),
                    },
                  ]
                : [],
          },
          {
            primary: pages <= 1,
            between: <output>{Math.round(scale * 100)}%</output>,
            commands: [
              {
                label: t("zoomOut"),
                icon: mdiMagnifyMinusOutline,
                disabled: scale <= 0.25,
                run: () => Z(Math.max(0.25, scale - 0.25)),
              },
              {
                label: t("zoomIn"),
                icon: mdiMagnifyPlusOutline,
                disabled: scale >= 4,
                run: () => Z(Math.min(4, scale + 0.25)),
              },
              { label: t("fit"), icon: mdiFitToScreenOutline, run: () => Z(1) },
            ],
          },
        ]}
      />
      <div className="vw-doc" ref={area} aria-busy={busy}>
        {busy && <p role="status">{t("loading")}</p>}
        {error && (
          <p role="alert">
            {error}{" "}
            <button
              onClick={() => {
                E("");
                B(true);
                R(retry + 1);
              }}
            >
              {t("retry")}
            </button>
          </p>
        )}
        {kind === "pdf" ? (
          <canvas aria-label={t("page") + " " + page} ref={canvas} />
        ) : (
          image &&
          !busy &&
          !error && (
            <img
              alt={t("page") + " " + page}
              src={image}
              style={{ width: width * scale }}
            />
          )
        )}
      </div>
    </>
  );
}
