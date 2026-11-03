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
import * as dialog from "@radix-ui/react-dialog";
import * as react from "react";import * as jsx from "react/jsx-runtime";import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider,useQueryClient,useQuery} from "@tanstack/react-query";
const root=createRoot(document.getElementById("root")),client=new QueryClient(),dict={};
const Icon = ({path,size}) => jsx.jsx("svg",{width:size,height:size,"aria-hidden":true,children:jsx.jsx("path",{d:path})});
const Button = ({title,...props}) => jsx.jsx("button",{"data-tooltip":title,"aria-label":props["aria-label"] ?? title,...props});
const DialogContent = ({header,footer,children}) => jsx.jsxs(dialog.Content,{children:[header,children,footer]});
const Notice = ({children,error}) => jsx.jsx("p",{role:error?"alert":"status",children});
window.PaNasMsSDK={react,jsx,dialog,ui:{Button,Icon,DialogContent,Notice},query:{useQueryClient,useQuery},runtime:{registerModule:m=>window.mod=m},i18n:{registerTranslations:(_,d)=>Object.assign(dict,d.en),translator:()=>k=>dict[k]||k,locale:()=>"en"}};
window.pendingThumbs=()=>client.isFetching();
window.files=["a.webp","b.svg","c.png","test.js","test.json","test.yaml","doc.md","doc.html","sample.pdf","long.pdf","single.pdf","sample.djvu","read.txt"].map(name=>({name,path:"/"+name,revision:"a".repeat(64),size:24}));
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
function pdf(count) {
  const kids = Array.from({ length: count }, (_, i) => 3 + i * 2 + " 0 R");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${count} >>`,
  ];
  for (let i = 0; i < count; i++) {
    const paint = (i % 2 ? "0 0 1" : "1 0 0") + " rg 0 0 300 400 re f\n";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${paint.length} >>\nstream\n${paint}endstream`,
    );
  }
  let result = "%PDF-1.4\n";
  const offsets = objects.map((obj, i) => {
    const offset = result.length;
    result += i + 1 + " 0 obj\n" + obj + "\nendobj\n";
    return String(offset).padStart(10, "0") + " 00000 n \n";
  });
  const start = result.length;
  return (
    result +
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  );
}
content["sample.pdf"] = pdf(2);
content["single.pdf"] = pdf(1);
content["long.pdf"] = pdf(40);
let failedThumbReads = 0;
let failSave = false,
  put = 0,
  lostReplies = 0,
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
        '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/api/v1/module-assets/viewers/index.css"><main id="root"></main><script src="/host.js"></script><script src="/api/v1/module-assets/viewers/index.js"></script>',
      );
    }
    if (url.pathname === "/host.js") {
      res.setHeader("Content-Type", "application/javascript");
      return res.end(bootstrap);
    }
    if (url.pathname === "/api/v1/files/content") {
      const key = url.searchParams.get("target").replace("viewer:/", "");
      if (url.searchParams.get("thumbnail") === "1") {
        const target = url.searchParams.get("target");
        if (target === "/missing-preview.png") {
          failedThumbReads++;
          res.statusCode = 404;
          return res.end();
        }
        // Match the real Files thumbnail contract: raw local paths, not viewer-prefixed downloads.
        if (/^\/album\/\d+\.png$/.test(target)) {
          res.setHeader("Content-Type", "image/png");
          return res.end(content["c.png"]);
        }
        assert.ok(["/a.webp", "/c.png"].includes(target), target);
        res.setHeader(
          "Content-Type",
          target === "/c.png" ? "image/png" : "image/webp",
        );
        return res.end(content[target.slice(1)]);
      }
      if (req.method === "PUT" && key.startsWith("viewer-image:")) {
        assert.equal(url.searchParams.get("replace_revision"), "a".repeat(64));
        const chunks = [];
        for await (const c of req) chunks.push(c);
        savedImage = Buffer.concat(chunks);
        res.statusCode = 204;
        return res.end();
      }
      if (req.method === "PUT") {
        if (failSave === "lost") lostReplies++;
        else put++;
        assert.equal(req.headers["x-panasms-request"], "1");
        assert.equal(url.searchParams.get("replace_revision"), "a".repeat(64));
        const chunks = [];
        for await (const c of req) chunks.push(c);
        bytes = Buffer.concat(chunks).toString();
        if (failSave === "lost") {
          req.socket.destroy();
          return;
        }
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
        : extname(f) === ".css"
          ? "text/css"
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
  const strip = page.getByRole("navigation", { name: "Images in this folder" });
  assert.equal(await strip.getByRole("button").count(), 3);
  assert.equal(
    await page.getByRole("button", { name: "Previous", exact: true }).count(),
    0,
  );
  await page.waitForFunction(
    () => document.querySelector(".vw-slides img")?.naturalWidth > 0,
  );
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.locator(".vw-next").click();
  await page.getByRole("heading", { name: "b.svg" }).waitFor();
  await strip.getByRole("button", { name: "c.png" }).click();
  await page.getByRole("heading", { name: "c.png" }).waitFor();
  assert.equal(await page.locator(".vw-next").count(), 0);
  assert.equal(
    await strip.locator('[aria-current="true"]').getAttribute("aria-label"),
    "c.png",
  );
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("heading", { name: "b.svg" }).waitFor();
  await page.locator(".vw-prev").click();
  await page.getByRole("heading", { name: "a.webp" }).waitFor();
  assert.ok(await page.evaluate(() => !!document.fullscreenElement));
  await page.getByRole("button", { name: "Full screen" }).click();
  await page.getByRole("button", { name: "Rotate right" }).click();
  assert.match(
    await page.locator(".vw-stage img").getAttribute("style"),
    /90deg/,
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator(":focus").getAttribute("data-tooltip"),
    "Monochrome",
  );
  await page.locator(".vw-stage").focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("heading", { name: "b.svg" }).waitFor();
  await open("c.png");
  await page.getByRole("button", { name: "Rotate right" }).click();
  await page.getByRole("button", { name: "Save image…" }).click();
  await page.getByRole("combobox", { name: "Save as" }).selectOption("replace");
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
  failSave = "lost";
  await page.keyboard.press("Control+s");
  await page.getByText(/Save not confirmed/).waitFor();
  await page.waitForFunction(() => !document.querySelector(".vw-code")?.inert);
  assert.match(await page.locator(".cm-content").innerText(), /edited/);
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
  const pdfStrip = page.getByRole("navigation", { name: "Document pages" });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".vw-reader .vw-slides canvas:not([hidden])")
        .length === 2,
  );
  assert.deepEqual(
    await pdfStrip
      .locator("canvas")
      .evaluateAll((nodes) =>
        nodes.map((c) =>
          Array.from(c.getContext("2d").getImageData(4, 4, 1, 1).data),
        ),
      ),
    [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ],
  );
  await pdfStrip.getByRole("button", { name: "Page 1", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await pdfStrip.locator("[aria-current]").getAttribute("aria-label"),
    "Page 2",
  );
  assert.equal(
    await page.getByRole("button", { name: "Next", exact: true }).count(),
    0,
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await open("long.pdf");
  const jump = page.getByRole("spinbutton", { name: "Page", exact: true });
  await jump.fill("37");
  await jump.press("Enter");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".vw-slides [aria-current]")
        ?.getAttribute("aria-label") === "Page 37",
  );
  assert.ok((await pdfStrip.locator("canvas").count()) < 12);
  const inside = await pdfStrip.locator("[aria-current]").evaluate((b) => {
    const tile = b.getBoundingClientRect(),
      rail = b.parentElement.getBoundingClientRect();
    return tile.left >= rail.left && tile.right <= rail.right;
  });
  assert.ok(inside);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1280, height: 760 });
  await open("c.png");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    const menu = page.getByRole("combobox", { name: "Tools" });
    assert.equal(await menu.isVisible(), width < 640);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    if (width < 640) {
      await menu.selectOption({ label: "Rotate right" });
      await menu.selectOption({ label: "Save image…" });
      assert.equal(
        await page.getByRole("combobox", { name: "Save as" }).inputValue(),
        "copy",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
  }
  await open("single.pdf");
  await page.waitForFunction(
    () =>
      document.querySelector(".vw-doc")?.getAttribute("aria-busy") === "false",
  );
  assert.equal(await page.getByRole("spinbutton").count(), 0);
  assert.equal(await pdfStrip.count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Previous", exact: true }).count(),
    0,
  );
  await page.setViewportSize({ width: 960, height: 720 });
  await page.evaluate(() =>
    window.files.push({
      name: "missing-preview.png",
      path: "/missing-preview.png",
      size: 128,
      revision: "b".repeat(64),
    }),
  );
  const failed = page.waitForResponse(
    (r) =>
      r.url().includes("thumbnail=1") && r.url().includes("missing-preview"),
  );
  await open("a.webp");
  await failed;
  await page.waitForFunction(() => window.pendingThumbs() === 0);
  await page.locator(".vw-next").click();
  await page.getByRole("heading", { name: "b.svg" }).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".vw-slides button img,.vw-slides button svg")
        .length === 4 && window.pendingThumbs() === 0,
  );
  assert.equal(
    failedThumbReads,
    1,
    "failed thumbnail retried when viewer remounted",
  );
  await page.evaluate(() => {
    window.files = window.files.filter((e) => e.name !== "missing-preview.png");
  });
  await page.evaluate(() => {
    window.files = window.files.filter((e) => e.name === "c.png");
  });
  await open("c.png");
  await page.locator(".vw-stage img").waitFor();
  assert.equal(await strip.count(), 0);
  assert.equal(await page.locator(".vw-edge").count(), 0);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.evaluate(() => {
    const fixture = window.files[0];
    window.files = Array.from({ length: 80 }, (_, i) => ({
      ...fixture,
      path: "/album/" + i + ".png",
      name: "album-" + i + ".png",
    }));
  });
  await open("album-65.png");
  await page.locator(".vw-stage [role=alert]").waitFor();
  const bounds = await strip.evaluate((nav) => {
    const track = nav.querySelector(".vw-slides"),
      current = nav.querySelector("[aria-current]").getBoundingClientRect();
    return {
      left: track.getBoundingClientRect().left,
      right: track.getBoundingClientRect().right,
      start: current.left,
      end: current.right,
    };
  });
  assert.ok(
    bounds.start >= bounds.left && bounds.end <= bounds.right,
    "selected thumbnail visible after opening a deep link",
  );
  assert.ok(
    await page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter(
            (e) => e.name.includes("thumbnail=1") && e.name.includes("album"),
          ).length < 20,
    ),
    "offscreen thumbnails stay lazy",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("heading", { name: "album-66.png" }).waitFor();
  assert.equal(put, 6);
  assert.ok(lostReplies >= 1);
  console.log(
    "Gallery, code formatters, Markdown/HTML visual editing, conflict recovery, read-only files and two PDF pages passed.",
  );
} finally {
  await browser?.close();
  srv.closeAllConnections();
  await new Promise((resolve) => srv.close(resolve));
}
