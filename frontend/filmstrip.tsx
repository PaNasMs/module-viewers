import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@panasms/ui";
import { mdiImageOutline } from "@mdi/js";
import { imageBlob, read } from "./io";
import { type Entry } from "./types";
import { t } from "./strings";

async function thumbnail(entry: Entry, signal: AbortSignal) {
  signal.throwIfAborted();
  if (
    entry.path.startsWith("/") &&
    /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(entry.name)
  ) {
    const params = new URLSearchParams({ thumbnail: "1", target: entry.path });
    const response = await fetch("/api/v1/files/content?" + params, { signal });
    if (!response.ok) throw Error(t("decode"));
    return response.blob();
  }
  const original = await read(entry, 48 * 1048576, signal);
  const file = await imageBlob(original, entry.name, signal, true);
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    signal.throwIfAborted();
    const ratio = Math.min(
      1,
      176 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) =>
        blob ? resolve(blob) : reject(Error(t("decode"))),
      ),
    );
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Leave a decoder slot for the full-size image while nearby previews load.
let queue = Promise.resolve();
function Preview({ entry }: { entry: Entry }) {
  const { data } = useQuery({
    queryKey: [
      "viewer-thumbnail",
      entry.path,
      entry.revision,
      entry.modified,
      entry.size,
    ],
    staleTime: 60000,
    gcTime: 60000,
    retry: false,
    queryFn: ({ signal }) => {
      const job = queue.then(() => thumbnail(entry, signal));
      queue = job.then(
        () => {},
        () => {},
      );
      return job;
    },
  });
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!data) return;
    const src = URL.createObjectURL(data);
    setUrl(src);
    return () => URL.revokeObjectURL(src);
  }, [data]);
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

export const Filmstrip = memo(function Filmstrip({
  entries,
  index,
  activeUrl,
  open,
}: {
  entries: Entry[];
  index: number;
  activeUrl: string;
  open: (e: Entry) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(new Set<number>());
  useLayoutEffect(() => {
    const el = track.current!;
    const active = el.children[index] as HTMLElement | undefined;
    if (active)
      el.scrollLeft +=
        active.getBoundingClientRect().left -
        el.getBoundingClientRect().left -
        (el.clientWidth - active.offsetWidth) / 2;
  }, [index]);
  useEffect(() => {
    const el = track.current!;
    const observer = new IntersectionObserver(
      (changes) => {
        setVisible((old) => {
          const next = new Set(old);
          for (const change of changes) {
            const i = Number((change.target as HTMLElement).dataset.index);
            if (change.isIntersecting) next.add(i);
            else next.delete(i);
          }
          return next;
        });
      },
      { root: el, rootMargin: "0px 80px" },
    );
    for (const item of Array.from(el.children)) observer.observe(item);
    return () => observer.disconnect();
  }, [entries]);
  return (
    <nav className="vw-filmstrip" aria-label={t("filmstrip")}>
      <div className="vw-thumbs" ref={track}>
        {entries.map((entry, i) => (
          <button
            key={entry.path}
            type="button"
            tabIndex={i === index ? 0 : -1}
            data-index={i}
            aria-current={i === index ? "true" : undefined}
            aria-label={entry.name}
            data-tooltip={entry.name}
            onClick={() => {
              if (i !== index) open(entry);
            }}
          >
            <span className="vw-thumb-fallback">
              <Icon path={mdiImageOutline} size={18} />
              <span>{entry.name}</span>
            </span>
            {i === index
              ? activeUrl && <img src={activeUrl} alt="" draggable={false} />
              : visible.has(i) && <Preview entry={entry} />}
          </button>
        ))}
      </div>
      <span className="vw-count" aria-live="polite">
        {index + 1} / {entries.length}
      </span>
    </nav>
  );
});
