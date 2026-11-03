import * as Dialog from "@radix-ui/react-dialog";
import { Button, DialogContent, Notice } from "@panasms/ui";
import { useEffect, useRef, useState } from "react";
import { ext, type Props } from "./types";
import { writeFile } from "./io";
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
  const [mode, setMode] = useState<"replace" | "copy" | "download">(
    readOnly ? "download" : "copy",
  );
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
      await writeFile(
        "/api/v1/files/content?" + params,
        result,
        mode === "replace" ? "conflict" : "copyFail",
      );
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) cancel();
      }}
    >
      <Dialog.Portal
        container={document.fullscreenElement as HTMLElement | null}
      >
        <Dialog.Overlay className="dialog-overlay" />
        <DialogContent
          className="settings-dialog vw-save"
          variant="form"
          intent="edit"
          dirty={false}
          busy={busy}
          message={t("saving")}
          header={
            <>
              <Dialog.Title>{t("imageSave").replace(/…$/, "")}</Dialog.Title>
              <Dialog.Description>{entry.name}</Dialog.Description>
            </>
          }
          footer={
            <div className="dialog-actions">
              <Button data-dialog-cancel disabled={busy} onClick={cancel}>
                {t("cancel")}
              </Button>
              <Button
                className={mode === "replace" ? "danger" : "primary"}
                disabled={busy}
                onClick={() => void apply(mode)}
              >
                {t(
                  mode === "replace"
                    ? "replace"
                    : mode === "copy"
                      ? "save"
                      : "get",
                )}
              </Button>
            </div>
          }
        >
          <div className="vw-fields">
            <label>
              {t("destination")}
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                {!readOnly && <option value="copy">{t("copy")}</option>}
                <option value="download">{t("downloadPNG")}</option>
                {replace && <option value="replace">{t("replace")}</option>}
              </select>
            </label>
            {mode !== "replace" && (
              <label>
                {t("copyName")}
                <input value={name} onChange={(e) => N(e.target.value)} />
              </label>
            )}
            <label className="vw-check">
              <input
                type="checkbox"
                checked={resize}
                onChange={(e) => R(e.target.checked)}
              />
              {t("resize")}
            </label>
            <output>
              {t("pixels")}:{" "}
              <strong>
                {width} × {height}
              </strong>
            </output>
            <p>{t("imageWarning")}</p>
            {error && <Notice error>{error}</Notice>}
          </div>
        </DialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
