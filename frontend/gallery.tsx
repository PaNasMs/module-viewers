import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const strip = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<number>>(() => new Set());
  useLayoutEffect(() => {
    const el = strip.current;
    const active = el?.children[index] as HTMLButtonElement | undefined;
    if (!el || !active) return;
    el.scrollLeft =
      active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    if (restoreFocus) active.focus({ preventScroll: true });
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
  }, [group]);
  return (
    <nav className="vw-filmstrip" aria-label={t("gallery")}>
      <span className="vw-count">
        {index + 1} / {group.length}
      </span>
      <div className="vw-slides" ref={strip}>
        {group.map((file, n) => (
          <button
            type="button"
            key={file.path}
            data-index={n}
            aria-current={n === index ? "true" : undefined}
            aria-label={file.name}
            data-tooltip={file.name}
            tabIndex={n === index ? 0 : -1}
            onClick={() => {
              if (n !== index) choose(file);
            }}
          >
            {n === index && activeUrl ? (
              <img src={activeUrl} alt="" draggable={false} />
            ) : (
              visible.has(n) && n !== index && <Preview entry={file} />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
