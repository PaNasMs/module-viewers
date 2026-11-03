import { build } from "esbuild";
import { mkdir, cp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const out = "dist/ui";
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const sdk = {
  react: "react",
  "react/jsx-runtime": "jsx",
  "@tanstack/react-query": "query",
  "@panasms/runtime": "runtime",
  "@panasms/i18n": "i18n",
  "@panasms/ui": "ui",
  "@radix-ui/react-dialog": "dialog",
};
const shared = {
  name: "host-sdk",
  setup(b) {
    b.onResolve(
      {
        filter:
          /^(?:react(?:\/jsx-runtime)?|@panasms\/(?:runtime|i18n|ui)|@radix-ui\/react-dialog|@tanstack\/react-query)$/,
      },
      (a) => ({ path: a.path, namespace: "sdk" }),
    );
    b.onLoad({ filter: /.*/, namespace: "sdk" }, (a) => ({
      contents: "module.exports=globalThis.PaNasMsSDK." + sdk[a.path],
    }));
  },
};
const opts = {
  bundle: true,
  minify: true,
  jsx: "automatic",
  target: "es2022",
  plugins: [shared],
  legalComments: "eof",
  alias: { "@mdi/js": "./node_modules/@mdi/js/mdi.js" },
  metafile: true,
};
const a = await build({
  ...opts,
  entryPoints: ["frontend/main.tsx"],
  outfile: out + "/index.js",
  format: "iife",
});
const b = await build({
  ...opts,
  entryPoints: ["frontend/workspace.tsx"],
  outdir: out,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
});
await cp("frontend/viewers.css", out + "/index.css");
const pdf = "node_modules/pdfjs-dist/";
await cp(pdf + "build/pdf.worker.min.mjs", out + "/pdf.worker.min.mjs");
for (const [src, dst] of [
  ["cmaps", "cmaps"],
  ["standard_fonts", "fonts"],
])
  await cp(pdf + src, out + "/" + dst, { recursive: true });
await mkdir(out + "/wasm");
for (const f of await readdir(pdf + "wasm"))
  if (f.includes("nowasm") || f.startsWith("LICENSE"))
    await cp(pdf + "wasm/" + f, out + "/wasm/" + f);
const roots = new Set(
  [...Object.keys(a.metafile.inputs), ...Object.keys(b.metafile.inputs)]
    .filter((k) => k.includes("node_modules/"))
    .map((k) => k.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1])
    .filter(Boolean),
);
let notices = await readFile("NOTICE", "utf8");
for (const root of [...roots].sort()) {
  const files = await readdir(root);
  for (const f of files.filter((f) =>
    /^(licen[cs]e|copying|notice)(?:$|[.-])/i.test(f),
  )) {
    const txt = await readFile(path.join(root, f), "utf8");
    notices +=
      "\n\n" + root.split("node_modules/").pop() + "/" + f + "\n" + txt;
  }
}
await writeFile("dist/NOTICE", notices);
