import { t } from "./strings";
import type { Entry } from "./types";
export const content = (e: Entry) =>
  "/api/v1/files/content?" +
  new URLSearchParams({ target: "viewer:" + e.path });
export async function read(e: Entry, limit: number, signal: AbortSignal) {
  if (e.size > limit) throw Error(t("limit"));
  const r = await fetch(content(e), { signal });
  if (!r.ok || !r.body) throw Error(t("error"));
  const stream = r.body.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let n = 0;
  for (;;) {
    const result = await stream.read();
    if (result.done) break;
    n += result.value.byteLength;
    if (n > limit) {
      await stream.cancel();
      throw Error(t("limit"));
    }
    chunks.push(result.value);
  }
  return new Blob(chunks);
}
export async function decode(
  blob: Blob,
  format: string,
  page: number,
  signal: AbortSignal,
) {
  const r = await fetch(
    "/api/v1/module-api/viewers/render?" +
      new URLSearchParams({ format, page: String(page) }),
    {
      method: "POST",
      body: blob,
      headers: { "X-PaNasMs-Request": "1" },
      signal,
    },
  );
  if (!r.ok) throw Error(t(r.status === 429 ? "busy" : "decode"));
  return {
    blob: await r.blob(),
    pages: Number(r.headers.get("X-Page-Count")) || 1,
  };
}
