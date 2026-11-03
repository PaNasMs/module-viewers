import { Button, Icon } from "@panasms/ui";
import { Carousel } from "./gallery";
import { PdfThumbnail } from "./pdf-thumbnail";
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
  const album = kind === "pdf" && pages > 1;
  const [width, W] = useState(800),
    [height, H] = useState(600);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const a = area.current!;
    const obs = new ResizeObserver(() => {
      W(Math.max(1, a.clientWidth - 24));
      H(Math.max(1, a.clientHeight - 16));
    });
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
            scale *
              (album
                ? Math.min(width / v.width, height / v.height)
                : width / v.width),
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
    album ? height : 0,
    album,
    retry,
  ]);
  function showPage(n: number) {
    if (n < 1 || n > pages || n === page) return;
    area.current?.scrollTo(0, 0);
    P(n);
  }
  const [stripFocus, setStripFocus] = useState(false);
  useEffect(() => {
    if (album && document.activeElement === document.body)
      area.current?.focus({ preventScroll: true });
  }, [album]);
  const pageNumber = (
    <label className="vw-count vw-page-number">
      <input
        key={page}
        aria-label={t("page")}
        type="number"
        min={1}
        max={pages || 1}
        style={{
          width: `calc(${Math.max(2, String(pages).length)}ch + 3rem)`,
        }}
        defaultValue={page}
        onFocus={() => setStripFocus(false)}
        onBlur={(e) => {
          const n = +e.target.value;
          if (Number.isInteger(n) && n >= 1 && n <= pages) showPage(n);
          else e.target.value = String(page);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
            if (album) area.current?.focus({ preventScroll: true });
          }
        }}
      />{" "}
      / {pages || "…"}
    </label>
  );
  function pageKey(event: React.KeyboardEvent<HTMLElement>) {
    if (
      !album ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.target instanceof Element &&
        event.target.closest("input, select, [role=toolbar]"))
    )
      return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setStripFocus(
      event.target instanceof Element && !!event.target.closest(".vw-slides"),
    );
    showPage(page + (event.key === "ArrowLeft" ? -1 : 1));
  }
  function step(n: number) {
    setStripFocus(false);
    area.current?.focus({ preventScroll: true });
    showPage(n);
  }
  return (
    <div className="vw-reader" onKeyDown={pageKey}>
      <Toolbar
        groups={[
          {
            primary: true,
            between: pageNumber,
            commands:
              pages > 1 && !album
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
            primary: pages <= 1 || album,
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
      <div className={album ? "vw-page-area" : undefined}>
        <div
          className="vw-doc"
          ref={area}
          aria-busy={busy}
          tabIndex={album ? 0 : undefined}
          aria-label={album ? t("page") + " " + page : undefined}
          onTouchStart={(e) => {
            const touch = e.touches[0];
            gesture.current =
              album &&
              e.touches.length === 1 &&
              e.currentTarget.scrollWidth <= e.currentTarget.clientWidth
                ? { x: touch.clientX, y: touch.clientY }
                : null;
          }}
          onTouchCancel={() => {
            gesture.current = null;
          }}
          onTouchEnd={(e) => {
            const start = gesture.current;
            gesture.current = null;
            if (!start || e.touches.length) return;
            const dx = e.changedTouches[0].clientX - start.x,
              dy = e.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) > 70 && Math.abs(dy) < 45)
              step(page + (dx < 0 ? 1 : -1));
          }}
        >
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
        {album && page > 1 && (
          <Button
            className="vw-edge vw-prev"
            title={t("prev")}
            onClick={() => step(page - 1)}
          >
            <Icon path={mdiChevronLeft} size={28} />
          </Button>
        )}
        {album && page < pages && (
          <Button
            className="vw-edge vw-next"
            title={t("next")}
            onClick={() => step(page + 1)}
          >
            <Icon path={mdiChevronRight} size={28} />
          </Button>
        )}
      </div>
      {album && pdf && (
        <Carousel
          count={pages}
          index={page - 1}
          label={t("pageStrip")}
          counter={pageNumber}
          name={(n) => t("page") + " " + (n + 1)}
          restoreFocus={stripFocus}
          choose={(n) => {
            setStripFocus(true);
            showPage(n + 1);
          }}
          preview={(n, visible) => (
            <>
              {visible && <PdfThumbnail pdf={pdf} page={n + 1} />}
              <span className="vw-page-caption">{n + 1}</span>
            </>
          )}
        />
      )}
    </div>
  );
}
