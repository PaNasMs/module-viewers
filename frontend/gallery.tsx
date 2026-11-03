import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@panasms/ui";
import { mdiImageOutline } from "@mdi/js";
import { read, imageBlob } from "./io";
import { ext, type Entry } from "./types";
import { t } from "./strings";

async function makeThumbnail(entry: Entry, signal: AbortSignal) {
  signal.throwIfAborted();
  const format = ext(entry.name);
  let blob: Blob;
  if (
    entry.path.startsWith("/") &&
    /^(jpe?g|png|gif|webp|bmp|tiff?)$/.test(format) &&
    entry.size <= 64 * 1048576
  ) {
    const url =
      "/api/v1/files/content?" +
      new URLSearchParams({ target: entry.path, thumbnail: "1" });
    const response = await fetch(url, { signal });
    if (!response.ok) throw Error(t("decode"));
    blob = await response.blob();
  } else {
    const input = await read(entry, 48 * 1048576, signal);
    blob = await imageBlob(input, entry.name, signal, true);
  }
  signal.throwIfAborted();
  const image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const scale = Math.min(
      1,
      128 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Reserve the other native decoder slot for the photo being opened.
let pending = Promise.resolve();
function thumbnail(entry: Entry, signal: AbortSignal) {
  const result = pending.then(() => makeThumbnail(entry, signal));
  pending = result.then(
    () => {},
    () => {},
  );
  return result;
}
function Preview({ entry }: { entry: Entry }) {
  const image = useQuery({
    queryKey: [
      "viewers-filmstrip",
      entry.path,
      entry.revision,
      entry.modified,
      entry.size,
    ],
    queryFn: ({ signal }) => thumbnail(entry, signal),
    retry: false,
    retryOnMount: false,
    staleTime: 60_000,
    gcTime: 60_000,
  });
  return image.data ? (
    <img src={image.data} alt="" draggable={false} />
  ) : (
    <Icon path={mdiImageOutline} size={20} />
  );
}
export function Filmstrip({
  group,
  index,
  choose,
  restoreFocus,
  activeUrl,
}: {
  group: Entry[];
  index: number;
  choose: (entry: Entry) => void;
  restoreFocus: boolean;
  activeUrl: string;
}) {
  return (
    <Carousel
      count={group.length}
      index={index}
      label={t("gallery")}
      restoreFocus={restoreFocus}
      name={(n) => group[n].name}
      choose={(n) => choose(group[n])}
      preview={(n, visible) =>
        n === index && activeUrl ? (
          <img src={activeUrl} alt="" draggable={false} />
        ) : (
          visible && n !== index && <Preview entry={group[n]} />
        )
      }
    />
  );
}

export function Carousel({
  count,
  index,
  label,
  name,
  choose,
  preview,
  counter,
  restoreFocus = false,
}: {
  count: number;
  index: number;
  label: string;
  name: (n: number) => string;
  choose: (n: number) => void;
  preview: (n: number, visible: boolean) => ReactNode;
  counter?: ReactNode;
  restoreFocus?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<number>>(() => new Set());
  useLayoutEffect(() => {
    const el = strip.current;
    const active = el?.children[index] as HTMLButtonElement | undefined;
    if (!el || !active) return;
    const center = () => {
      el.scrollLeft =
        active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    };
    center();
    if (restoreFocus) active.focus({ preventScroll: true });
    const observer = new ResizeObserver(center);
    observer.observe(el);
    return () => observer.disconnect();
  }, [index, restoreFocus]);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (changes) =>
        setVisible((before) => {
          const after = new Set(before);
          for (const change of changes) {
            const id = Number((change.target as HTMLElement).dataset.index);
            if (change.isIntersecting) after.add(id);
            else after.delete(id);
          }
          return after;
        }),
      { root: el, rootMargin: "0px 64px" },
    );
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [count]);
  return (
    <nav className="vw-filmstrip" aria-label={label}>
      {counter ?? (
        <span className="vw-count">
          {index + 1} / {count}
        </span>
      )}
      <div className="vw-slides" ref={strip}>
        {Array.from({ length: count }, (_, n) => (
          <button
            type="button"
            key={n}
            data-index={n}
            aria-current={n === index ? "true" : undefined}
            aria-label={name(n)}
            data-tooltip={name(n)}
            tabIndex={n === index ? 0 : -1}
            onClick={() => {
              if (n !== index) choose(n);
            }}
          >
            {preview(n, visible.has(n))}
          </button>
        ))}
      </div>
    </nav>
  );
}
