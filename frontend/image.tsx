import { useEffect, useRef, useState } from "react";
import { converts, ext, kind, natives, type Props } from "./types";
import { decode } from "./io";
import { t } from "./strings";
import { ImageSave } from "./save-image";
export function ImageView({
  blob,
  entry,
  siblings,
  open,
  readOnly,
  saved,
}: Props & { blob: Blob }) {
  const group = siblings.filter((e) => kind(e.name) === "image"),
    i = group.findIndex((e) => e.path === entry.path);
  const [savePanel, saveOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(
      null,
    );
  const [url, U] = useState(""),
    [err, E] = useState(""),
    [turn, T] = useState(0),
    [zoom, Z] = useState<number | null>(null),
    [offset, O] = useState([0, 0]),
    [size, S] = useState([1, 1]),
    [box, B] = useState([1, 1]),
    [mono, M] = useState(false),
    [retry, R] = useState(0),
    [loaded, ready] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    let u = "";
    E("");
    U("");
    ready(false);
    const x = ext(entry.name);
    (async () => {
      const file = converts.has(x)
        ? (await decode(blob, x, 1, c.signal)).blob
        : blob.slice(0, blob.size, "image/" + natives[x]);
      if (!c.signal.aborted) {
        u = URL.createObjectURL(file);
        U(u);
      }
    })().catch((e) => {
      if (!c.signal.aborted) E(e.message);
    });
    return () => {
      c.abort();
      if (u) URL.revokeObjectURL(u);
    };
  }, [blob, entry.name, retry]);
  useEffect(() => {
    const el = frame.current!;
    const r = new ResizeObserver(() => B([el.clientWidth, el.clientHeight]));
    r.observe(el);
    return () => r.disconnect();
  }, []);
  const rotated = turn % 2 !== 0;
  const fit = Math.min(
    box[0] / size[rotated ? 1 : 0],
    box[1] / size[rotated ? 0 : 1],
    1,
  );
  const scale = zoom ?? fit;
  const adjust = (v: number) => Z(Math.min(12, Math.max(0.02, v)));
  const reset = () => {
    Z(null);
    O([0, 0]);
  };
  function step(n: number) {
    if (group[i + n]) open(group[i + n]);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        savePanel ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.defaultPrevented
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <>
      <div className="vw-tools" inert={savePanel}>
        <button disabled={!loaded || !!err} onClick={() => saveOpen(true)}>
          {t("imageSave")}
        </button>
        <button disabled={i <= 0} onClick={() => step(-1)}>
          ‹ {t("prev")}
        </button>
        <span>
          {i + 1} / {group.length}
        </span>
        <button disabled={i >= group.length - 1} onClick={() => step(1)}>
          {t("next")} ›
        </button>
        <button
          onClick={() => {
            T(turn - 1);
            O([0, 0]);
          }}
        >
          ↶ {t("left")}
        </button>
        <button
          onClick={() => {
            T(turn + 1);
            O([0, 0]);
          }}
        >
          ↷ {t("right")}
        </button>
        <button
          aria-label={t("zoomOut")}
          title={t("zoomOut")}
          onClick={() => adjust(scale / 1.3)}
        >
          −
        </button>
        <output>{Math.round(scale * 100)}%</output>
        <button
          aria-label={t("zoomIn")}
          title={t("zoomIn")}
          onClick={() => adjust(scale * 1.3)}
        >
          +
        </button>
        <button onClick={reset}>{t("fit")}</button>
        <button
          onClick={() => {
            Z(1);
            O([0, 0]);
          }}
        >
          1:1
        </button>
        <button aria-pressed={mono} onClick={() => M(!mono)}>
          {t("mono")}
        </button>
        <button
          onClick={() => {
            T(0);
            M(false);
            reset();
          }}
        >
          {t("reset")}
        </button>
        {document.fullscreenEnabled && (
          <button
            onClick={() => {
              const el = frame.current?.closest("section");
              void (
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : el?.requestFullscreen()
              )?.catch(() => E(t("error")));
            }}
          >
            {t("full")}
          </button>
        )}
      </div>
      {savePanel && frame.current?.querySelector("img") && (
        <ImageSave
          entry={entry}
          readOnly={readOnly}
          saved={saved}
          blob={blob}
          img={frame.current.querySelector("img")!}
          turn={turn}
          mono={mono}
          scale={scale}
          cancel={() => saveOpen(false)}
        />
      )}
      <div
        inert={savePanel}
        className="vw-stage"
        ref={frame}
        tabIndex={0}
        aria-label={entry.name}
        onDoubleClick={() => {
          if (zoom === 1) reset();
          else {
            Z(1);
            O([0, 0]);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || !url || err) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            dx: offset[0],
            dy: offset[1],
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const a = drag.current;
          if (a) O([a.dx + e.clientX - a.x, a.dy + e.clientY - a.y]);
        }}
        onPointerUp={(e) => {
          const a = drag.current;
          drag.current = null;
          if (
            a &&
            e.pointerType === "touch" &&
            !zoom &&
            Math.abs(e.clientX - a.x) > 70 &&
            Math.abs(e.clientY - a.y) < 45
          ) {
            O([0, 0]);
            step(e.clientX < a.x ? 1 : -1);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {err ? (
          <p role="alert">
            {err} <button onClick={() => R(retry + 1)}>{t("retry")}</button>
          </p>
        ) : url ? (
          <img
            src={url}
            alt={entry.name}
            draggable={false}
            onLoad={(e) => {
              S([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight]);
              ready(true);
            }}
            onError={() => E(t("decode"))}
            style={{
              width: size[0],
              height: size[1],
              transform: `translate(calc(-50% + ${offset[0]}px),calc(-50% + ${offset[1]}px)) rotate(${turn * 90}deg) scale(${scale})`,
              filter: mono ? "grayscale(1)" : undefined,
            }}
          />
        ) : (
          <p role="status">{t("loading")}</p>
        )}
      </div>
    </>
  );
}
