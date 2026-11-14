import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(
  process.env.FRONTEND_PACKAGE ?? resolve(root, "../../frontend/package.json"),
);
const frontendRoot = dirname(frontend);
const require = createRequire(frontend);
const { chromium, expect } = require("@playwright/test");
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: react } = await import(
  pathToFileURL(require.resolve("@vitejs/plugin-react")).href,
);
const { default: tailwind } = await import(
  pathToFileURL(require.resolve("@tailwindcss/vite")).href,
);
const aliases = Object.entries({
  "@fixture/sdk": "src/app/module-sdk.ts",
  "@fixture/registry": "src/app/module-registry.ts",
  "@fixture/i18n": "src/i18n/index.ts",
  "@fixture/style": "src/style.css",
  "@fixture/design": "src/design-system.css",
  "@fixture/home": "src/home/components.css",
}).map(([find, path]) => ({ find, replacement: resolve(frontendRoot, path) }));
for (const name of ["react/jsx-runtime", "react-dom/client", "react", "@tanstack/react-query"])
  aliases.push({
    find: new RegExp("^" + name + "$"),
    replacement: require.resolve(name),
  });
const staticAssets = {
  name: "viewers-fixture-assets",
  configureServer(server) {
    server.middlewares.use("/api/v1/module-assets/viewers", async (request, response, next) => {
      try {
        const path = decodeURIComponent(new URL(request.url, "http://fixture").pathname);
        const file = resolve(root, "dist/ui", path.replace(/^\/+/, ""));
        const contentType = extname(file) === ".css" ? "text/css" : "text/javascript";
        response.setHeader("Content-Type", contentType);
        response.end(await readFile(file));
      } catch {
        next();
      }
    });
  },
};
const server = await createServer({
  configFile: false,
  root,
  plugins: [react(), tailwind(), staticAssets],
  resolve: { alias: aliases },
  server: {
    host: "127.0.0.1",
    port: 15188,
    strictPort: true,
    fs: { allow: [root, frontendRoot] },
  },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];

try {
  for (const width of [320, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("http://127.0.0.1:15188/tests/dialog-drafts.html?theme=light&surface=solid");
    const openSave = async () => {
      if (width < 640)
        await page.getByRole("combobox", { name: "Tools", exact: true }).selectOption({ label: "Save image…" });
      else await page.getByRole("button", { name: "Save image…", exact: true }).click();
    };

    await openSave();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Save as")).toHaveValue("copy");
    await dialog.getByLabel("Save as").selectOption("download");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(dialog.getByLabel("Save as")).toHaveValue("download");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await openSave();
    dialog = page.getByRole("dialog");
    const name = dialog.getByLabel("Copy filename");
    await name.fill("synthetic-copy.png");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(name).toHaveValue("synthetic-copy.png");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await openSave();
    dialog = page.getByRole("dialog");
    const resize = dialog.getByLabel("Apply displayed zoom to pixel dimensions");
    await resize.check();
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(resize).toBeChecked();
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await openSave();
    dialog = page.getByRole("dialog");
    const revertedName = dialog.getByLabel("Copy filename");
    await revertedName.fill("temporary.png");
    await revertedName.fill("synthetic-image (1).png");
    await dialog.locator(".modal-footer").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Discard unsaved changes?", exact: true })).toHaveCount(0);

    assert.deepEqual(await page.evaluate(() => window.viewerDialogFixture.writes), []);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS built viewers bundle: synthetic image destination/name/resize dirty prompts, Keep editing, clean reversion, no writes; 320px and 1440px");
} finally {
  await browser.close();
  await server.close();
}
