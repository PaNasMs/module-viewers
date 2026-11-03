import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  type FileEntry,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { t } from "./strings";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const R =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PR =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const native = { useWebWorkers: false, useCompressionStream: true };
export function elements(node: Document | Element, ns: string, name: string) {
  return Array.from(node.getElementsByTagNameNS(ns, name));
}
export function child(node: Element, name: string) {
  return Array.from(node.children).find(
    (e) => e.namespaceURI === node.namespaceURI && e.localName === name,
  );
}
export function parseXml(text: string) {
  if (/<!DOCTYPE/i.test(text)) throw Error(t("decode"));
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw Error(t("decode"));
  return doc;
}
export class OfficePackage {
  parts = new Map<string, FileEntry>();
  private docs = new Map<string, Document>();
  changed = new Set<string>();
  signed = false;
  static async open(blob: Blob) {
    const pkg = new OfficePackage();
    const zip = new ZipReader(new BlobReader(blob), native);
    let size = 0;
    for await (const part of zip.getEntriesGenerator()) {
      if (part.directory) continue;
      size += part.uncompressedSize;
      if (
        part.encrypted ||
        pkg.parts.has(part.filename) ||
        part.filename.includes("\\") ||
        part.filename.split("/").some((s) => !s || s === "." || s === "..")
      )
        throw Error(t("decode"));
      if (size > 128 * 1048576 || pkg.parts.size >= 8000)
        throw Error(t("limit"));
      pkg.parts.set(part.filename, part);
    }
    const manifest = await pkg.xml("[Content_Types].xml");
    pkg.signed = Array.from(manifest.documentElement.children).some((e) =>
      /digital-signature|macroEnabled|vbaProject/i.test(
        e.getAttribute("ContentType") || "",
      ),
    );
    return pkg;
  }
  async xml(path: string) {
    if (!this.docs.has(path)) {
      const part = this.parts.get(path);
      if (!part || part.uncompressedSize > 12 * 1048576)
        throw Error(t("limit"));
      this.docs.set(
        path,
        parseXml(
          await part.getData(new TextWriter(), {
            ...native,
            checkSignature: true,
          }),
        ),
      );
    }
    return this.docs.get(path)!;
  }
  set(path: string, doc: Document) {
    this.docs.set(path, doc);
    this.changed.add(path);
  }
  async relationships(source: string) {
    const i = source.lastIndexOf("/") + 1;
    const path = source.slice(0, i) + "_rels/" + source.slice(i) + ".rels";
    const rels = new Map<string, { type: string; path: string }>();
    if (!this.parts.has(path)) return rels;
    for (const item of elements(await this.xml(path), PR, "Relationship")) {
      if (item.getAttribute("TargetMode") === "External") continue;
      const url = new URL(
        item.getAttribute("Target")!,
        "https://package.invalid/" + source,
      );
      if (url.origin !== "https://package.invalid") continue;
      rels.set(item.getAttribute("Id")!, {
        type: item.getAttribute("Type")!,
        path: decodeURIComponent(url.pathname.slice(1)),
      });
    }
    return rels;
  }
  async pack() {
    const out = new ZipWriter(new BlobWriter(), native);
    for (const path of new Set([...this.parts.keys(), ...this.changed])) {
      if (this.changed.has(path)) {
        const xml = new XMLSerializer().serializeToString(this.docs.get(path)!);
        await out.add(path, new TextReader(xml));
      } else {
        const part = this.parts.get(path)!;
        const compressed = await part.getData(new BlobWriter(), {
          passThrough: true,
          ...native,
        });
        await out.add(path, new BlobReader(compressed), {
          passThrough: true,
          compressionMethod: part.compressionMethod,
          uncompressedSize: part.uncompressedSize,
          crc32: part.crc32,
        });
      }
    }
    return out.close();
  }
}
