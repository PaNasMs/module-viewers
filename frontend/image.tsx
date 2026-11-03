import { Button, Icon } from "@panasms/ui";
import { Filmstrip } from "./filmstrip";
import { Toolbar } from "./toolbar";
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiFitToScreenOutline,
  mdiImageSizeSelectActual,
  mdiRotateLeft,
  mdiRotateRight,
  mdiCircleHalfFull,
  mdiRestore,
  mdiFullscreen,
  mdiContentSaveOutline,
} from "@mdi/js";
import { useEffect, useMemo, useRef, useState } from "react";
import { kind, type Props } from "./types";
import { imageBlob, read } from "./io";
import { t } from "./strings";
import { ImageSave } from "./save-image";
export function ImageView({ entry, siblings, open, readOnly, saved }: Props) {
  const group = useMemo(
      () => siblings.filter((e) => kind(e.name) === "image"),
      [siblings],
    ),
    i = group.findIndex((e) => e.path === entry.path);
  const [blob, setBlob] = useState<Blob>();
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
    (async () => {
      const original = await read(entry, 48 * 1048576, c.signal);
      const file = await imageBlob(original, entry.name, c.signal);
      if (!c.signal.aborted) {
        setBlob(original);
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
  }, [entry, retry]);
  useEffect(() => {
    const el = frame.current!;
    if (document.activeElement === document.body)
      el.focus({ preventScroll: true });
    const host = el.closest(".vw")?.parentElement;
    const r = new ResizeObserver(() => B([el.clientWidth, el.clientHeight]));
    r.observe(el);
    return () => {
      r.disconnect();
      if (host && document.fullscreenElement === host)
        requestAnimationFrame(() => {
          if (
            document.fullscreenElement === host &&
            !host.querySelector(".vw-photo")
          )
            void document.exitFullscreen().catch(() => {});
        });
    };
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
        group.length <= 1 ||
        savePanel ||
        (e.target instanceof Element &&
          !!e.target.closest("select, input, [role=dialog]")) ||
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
      <Toolbar
        groups={[
          {
            primary: true,
            between: <output>{Math.round(scale * 100)}%</output>,
            commands: [
              {
                label: t("zoomOut"),
                icon: mdiMagnifyMinusOutline,
                run: () => adjust(scale / 1.3),
              },
              {
                label: t("zoomIn"),
                icon: mdiMagnifyPlusOutline,
                run: () => adjust(scale * 1.3),
              },
            ],
          },
          {
            commands: [
              {
                label: t("fit"),
                icon: mdiFitToScreenOutline,
                pressed: zoom === null,
                run: reset,
              },
              {
                label: t("actual"),
                icon: mdiImageSizeSelectActual,
                run: () => {
                  Z(1);
                  O([0, 0]);
                },
              },
            ],
          },
          {
            commands: [
              {
                label: t("left"),
                icon: mdiRotateLeft,
                run: () => {
                  T(turn - 1);
                  O([0, 0]);
                },
              },
              {
                label: t("right"),
                icon: mdiRotateRight,
                run: () => {
                  T(turn + 1);
                  O([0, 0]);
                },
              },
              {
                label: t("mono"),
                icon: mdiCircleHalfFull,
                pressed: mono,
                run: () => M(!mono),
              },
              {
                label: t("reset"),
                icon: mdiRestore,
                run: () => {
                  T(0);
                  M(false);
                  reset();
                },
              },
            ],
          },
          {
            commands: [
              ...(document.fullscreenEnabled
                ? [
                    {
                      label: t("full"),
                      icon: mdiFullscreen,
                      run: () => {
                        const el = frame.current?.closest(".vw")?.parentElement;
                        void (
                          document.fullscreenElement
                            ? document.exitFullscreen()
                            : el?.requestFullscreen()
                        )?.catch(() => E(t("error")));
                      },
                    },
                  ]
                : []),
              {
                label: t("imageSave"),
                icon: mdiContentSaveOutline,
                disabled: !loaded || !!err,
                run: () => saveOpen(true),
              },
            ],
          },
        ]}
      />
      {savePanel && blob && frame.current?.querySelector("img") && (
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
      <div className="vw-photo" inert={savePanel}>
        <div
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
                S([
                  e.currentTarget.naturalWidth,
                  e.currentTarget.naturalHeight,
                ]);
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
        {[-1, 1].map(
          (delta) =>
            group[i + delta] &&
            i >= 0 && (
              <Button
                type="button"
                key={delta}
                className={"vw-step " + (delta < 0 ? "previous" : "next")}
                title={t(delta < 0 ? "prev" : "next")}
                onClick={() => step(delta)}
              >
                <Icon
                  path={delta < 0 ? mdiChevronLeft : mdiChevronRight}
                  size={24}
                />
              </Button>
            ),
        )}
      </div>
      {i >= 0 && group.length > 1 && (
        <Filmstrip
          entries={group}
          index={i}
          open={open}
          activeUrl={err ? "" : url}
        />
      )}
    </>
  );
}
