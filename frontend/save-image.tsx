import { useEffect, useRef, useState } from "react";
import { ext, type Props } from "./types";
import { t } from "./strings";
function isStatic(bytes: Uint8Array, format: string) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tag = (off: number) => String.fromCharCode(...bytes.subarray(off, off + 4));
  if (format === "jpeg") return bytes[0] === 255 && bytes[1] === 216;
  if (format === "png" && tag(1) === "PNG\r") {
    let off = 8;
    while (off + 12 <= bytes.length) {
      const len = v.getUint32(off),
        id = tag(off + 4);
      if (len > bytes.length - off - 12 || id === "acTL") return false;
      if (id === "IDAT") return true;
      off += 12 + len;
    }
  }
  if (format === "webp" && tag(0) === "RIFF" && tag(8) === "WEBP") {
    let off = 12;
    while (off + 8 <= bytes.length) {
      const len = v.getUint32(off + 4, true),
        id = tag(off);
      if (
        len > bytes.length - off - 8 ||
        id === "ANIM" ||
        id === "ANMF" ||
        (id === "VP8X" && bytes[off + 8] & 2)
      )
        return false;
      if (id === "VP8 " || id === "VP8L") return true;
      off += 8 + len + (len % 2);
    }
  }
  return false;
}
export function ImageSave({
  entry,
  readOnly,
  blob,
  img,
  turn,
  mono,
  scale,
  saved,
  cancel,
}: {
  entry: Props["entry"];
  readOnly: boolean;
  blob: Blob;
  img: HTMLImageElement;
  turn: number;
  mono: boolean;
  scale: number;
  saved: () => void | Promise<void>;
  cancel: () => void;
}) {
  const [resize, R] = useState(false),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [replace, A] = useState(false),
    [name, N] = useState(entry.name.replace(/\.[^.]+$/, "") + " (1).png");
  const factor = resize ? scale : 1,
    w = Math.max(1, Math.round(img.naturalWidth * factor)),
    h = Math.max(1, Math.round(img.naturalHeight * factor)),
    [width, height] = turn % 2 ? [h, w] : [w, h];
  const x = ext(entry.name),
    format = ["jpg", "jpeg", "jfif"].includes(x) ? "jpeg" : x,
    locked = useRef(false);
  useEffect(() => {
    let alive = true;
    if (!readOnly && entry.revision && ["jpeg", "png", "webp"].includes(format))
      void blob
        .arrayBuffer()
        .then((b) => {
          if (alive) A(isStatic(new Uint8Array(b), format));
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [blob, readOnly, entry.revision, format]);
  async function apply(mode: "replace" | "copy" | "download") {
    if (locked.current || (mode === "replace" && !replace)) return;
    locked.current = true;
    B(true);
    E("");
    try {
      if (width * height > 32_000_000 || width > 16384 || height > 16384)
        throw Error(t("saveSize"));
      const copyName = name.trim();
      if (
        mode !== "replace" &&
        (!/^[^/\\\x00-\x1f\x7f]+\.png$/i.test(copyName) ||
          copyName === entry.name ||
          new TextEncoder().encode(copyName).length > 255)
      )
        throw Error(t("copyFail"));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error(t("error"));
      ctx.translate(width / 2, height / 2);
      ctx.rotate((turn * Math.PI) / 2);
      if (mono) ctx.filter = "grayscale(1)";
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      const mime = "image/" + (mode === "replace" ? format : "png");
      const result = await new Promise<Blob | null>((ok) =>
        canvas.toBlob(ok, mime, 0.95),
      );
      canvas.width = canvas.height = 0;
      if (!result || result.type !== mime) throw Error(t("decode"));
      if (result.size > 48 * 1048576) throw Error(t("saveSize"));
      if (mode === "download") {
        const u = URL.createObjectURL(result),
          a = document.createElement("a");
        a.href = u;
        a.download = copyName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
        cancel();
        return;
      }
      const target =
        mode === "replace"
          ? "viewer-image:" + entry.path
          : entry.path.slice(0, entry.path.lastIndexOf("/") + 1) + copyName;
      const params = new URLSearchParams({ target });
      if (mode === "replace") params.set("replace_revision", entry.revision!);
      const res = await fetch("/api/v1/files/content?" + params, {
        method: "PUT",
        headers: { "X-PaNasMs-Request": "1" },
        body: result,
      });
      if (res.status !== 204)
        throw Error(t(mode === "replace" ? "conflict" : "copyFail"));
      window.dispatchEvent(
        new CustomEvent("panasms:toast", { detail: t("saved") }),
      );
      await saved();
    } catch (e) {
      E((e as Error).message);
    } finally {
      locked.current = false;
      B(false);
    }
  }
  return (
    <section className="vw-save" aria-label={t("imageSave")}>
      <p>
        {t("imageWarning")} {!replace && t("copyOnly")}
      </p>
      <div className="vw-tools">
        <label>
          <input
            type="checkbox"
            checked={resize}
            disabled={busy}
            onChange={(e) => R(e.target.checked)}
          />{" "}
          {t("resize")}
        </label>
        <output>
          {t("pixels")}: {width} × {height}
        </output>
      </div>
      <label>
        {t("copyName")}{" "}
        <input
          value={name}
          disabled={busy}
          onChange={(e) => N(e.target.value)}
        />
      </label>
      <div className="vw-tools">
        <button autoFocus disabled={busy} onClick={cancel}>
          {t("cancel")}
        </button>
        <button disabled={busy} onClick={() => void apply("download")}>
          {t("downloadPNG")}
        </button>
        {!readOnly && (
          <button disabled={busy} onClick={() => void apply("copy")}>
            {t("copy")}
          </button>
        )}
        {replace && (
          <button
            className="vw-danger"
            disabled={busy}
            onClick={() => void apply("replace")}
          >
            {t("replace")}
          </button>
        )}
      </div>
      {busy && <p role="status">{t("saving")}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
