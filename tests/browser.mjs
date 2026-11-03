import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import assert from "node:assert/strict";
const bootstrap = (
  await build({
    stdin: {
      contents: `
import * as react from "react";import * as jsx from "react/jsx-runtime";import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider,useQueryClient} from "@tanstack/react-query";
const root=createRoot(document.getElementById("root")),client=new QueryClient(),dict={};
window.PaNasMsSDK={react,jsx,query:{useQueryClient},runtime:{registerModule:m=>window.mod=m},i18n:{registerTranslations:(_,d)=>Object.assign(dict,d.en),translator:()=>k=>dict[k]||k,locale:()=>"en"}};
window.files=["a.webp","b.svg","c.png","test.js","test.json","test.yaml","doc.md","doc.html","sample.pdf","sample.djvu","read.txt"].map(name=>({name,path:"/"+name,revision:"a".repeat(64),size:24}));
window.openFixture=name=>{const entry=window.files.find(e=>e.name===name);root.render(jsx.jsx(QueryClientProvider,{client,children:jsx.jsx(window.mod.fileViewer.component,{entry,siblings:window.files,readOnly:name==="read.txt",open:e=>window.openFixture(e.name),close:()=>root.render("closed"),saved:()=>root.render("saved")},entry.path)}))};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    minify: true,
  })
).outputFiles[0].contents;
const content = {
  "test.js": "const x={a:1};",
  "test.json": '{"x":1}',
  "test.yaml": "languages: [en,ru]",
  "doc.md": "# Original\n\nText",
  "doc.html":
    "<!doctype html><html><head><title>X</title></head><body><p>Hello</p></body></html>",
  "read.txt": "hello",
  "b.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><rect width="80" height="20" fill="blue"/></svg>',
  "a.webp": Buffer.from(
    "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
    "base64",
  ),
};
function pdf() {
  let s = "%PDF-1.4\n",
    offset = [0];
  for (const obj of [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>",
  ]) {
    offset.push(s.length);
    s += String(offset.length - 1) + " 0 obj\n" + obj + "\nendobj\n";
  }
  const x = s.length;
  return (
    s +
    "xref\n0 5\n0000000000 65535 f \n" +
    offset
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n" +
    x +
    "\n%%EOF"
  );
}
content["sample.pdf"] = pdf();
let failSave = false,
  put = 0,
  bytes = "",
  savedImage;
content["c.png"] = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAADCAIAAAAhqtkfAAAAHUlEQVR4nGNk+M/wn5EBEzD+xyLIwMDAwIRDnAEAwX8DA8fRCCUAAAAASUVORK5CYII=",
  "base64",
);
const srv = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'",
      );
      res.setHeader("Content-Type", "text/html");
      return res.end(
        '<main id="root"></main><script src="/host.js"></script><script src="/api/v1/module-assets/viewers/index.js"></script>',
      );
    }
    if (url.pathname === "/host.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(bootstrap);
    }
    if (url.pathname === "/api/v1/files/content") {
      const key = url.searchParams.get("target").replace("viewer:/", "");
      if (req.method === "PUT" && key.startsWith("viewer-image:")) {
        assert.equal(url.searchParams.get("replace_revision"), "a".repeat(64));
        const chunks = [];
        for await (const c of req) chunks.push(c);
        savedImage = Buffer.concat(chunks);
        res.statusCode = 204;
        return res.end();
      }
      if (req.method === "PUT") {
        put++;
        assert.equal(req.headers["x-panasms-request"], "1");
        assert.equal(url.searchParams.get("replace_revision"), "a".repeat(64));
        const chunks = [];
        for await (const c of req) chunks.push(c);
        bytes = Buffer.concat(chunks).toString();
        res.statusCode = failSave ? 409 : 204;
        return res.end();
      }
      return res.end(content[key] ?? "fixture");
    }
    const prefix = "/api/v1/module-assets/viewers/";
    if (!url.pathname.startsWith(prefix)) throw Error();
    const f = resolve("dist/ui", url.pathname.slice(prefix.length));
    res.setHeader(
      "Content-Type",
      [".js", ".mjs"].includes(extname(f))
        ? "application/javascript"
        : "application/octet-stream",
    );
    res.end(await readFile(f));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.VIEWER_CHROME || undefined,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (err) => console.error(err));
  await page.goto("http://127.0.0.1:" + srv.address().port);
  const open = async (name) => {
    await page.evaluate((n) => window.openFixture(n), name);
    await page.getByRole("heading", { name, exact: true }).waitFor();
  };
  await open("a.webp");
  await page.waitForFunction(
    () => document.querySelector(".vw-stage img")?.naturalWidth > 0,
  );
  await page.getByRole("button", { name: "Rotate right" }).click();
  assert.match(
    await page.locator(".vw-stage img").getAttribute("style"),
    /90deg/,
  );
  await page.keyboard.press("ArrowRight");
  await page.getByRole("heading", { name: "b.svg" }).waitFor();
  await open("c.png");
  await page.getByRole("button", { name: "Rotate right" }).click();
  await page.getByRole("button", { name: "Save image…" }).click();
  await page.getByRole("button", { name: "Replace original" }).click();
  await page.getByText("saved", { exact: true }).waitFor();
  assert.equal(savedImage.readUInt32BE(16), 3);
  assert.equal(savedImage.readUInt32BE(20), 8);
  for (const name of ["test.js", "test.json", "test.yaml"]) {
    await open(name);
    await page.locator(".cm-content").waitFor();
    await page.getByRole("button", { name: "Format code" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("saved", { exact: true }).waitFor();
  }
  await open("doc.md");
  await page.getByRole("button", { name: "Visual editor" }).click();
  await page.locator(".tiptap").press("Control+End");
  await page.keyboard.type(" edited");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  assert.match(await page.locator(".cm-content").innerText(), /edited/);
  failSave = true;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Back to folder" }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();
  failSave = false;
  await page.keyboard.press("Control+s");
  await page.getByText("saved", { exact: true }).waitFor();
  assert.match(bytes, /edited/);
  await open("doc.html");
  await page.getByRole("button", { name: "Visual editor" }).click();
  await page.locator(".tiptap").press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Control+s");
  await page.getByText("saved", { exact: true }).waitFor();
  assert.match(bytes, /<head><title>X<\/title><\/head><body><p>Hello!<\/p>/);
  await open("read.txt");
  await page.locator(".cm-content").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save", exact: true }).isDisabled(),
    true,
  );
  await open("sample.pdf");
  await page.waitForFunction(
    () =>
      document.querySelector(".vw-doc")?.getAttribute("aria-busy") ===
        "false" && document.querySelector(".vw-doc canvas")?.height > 150,
  );
  await page.getByRole("button", { name: /Next/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("canvas")?.getAttribute("aria-label") ===
        "Page 2" &&
      document.querySelector(".vw-doc")?.getAttribute("aria-busy") === "false",
  );
  assert.equal(put, 6);
  console.log(
    "Gallery, code formatters, Markdown/HTML visual editing, conflict recovery, read-only files and two PDF pages passed.",
  );
} finally {
  await browser?.close();
  srv.closeAllConnections();
  await new Promise((resolve) => srv.close(resolve));
}
