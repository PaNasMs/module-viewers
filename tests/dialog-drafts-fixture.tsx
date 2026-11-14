import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initializeLanguage } from "@fixture/i18n";
import { modules } from "@fixture/registry";
import "@fixture/sdk";
import "@fixture/style";
import "@fixture/design";
import "@fixture/home";

const requests: { method: string; path: string }[] = [];
const writes: { method: string; path: string }[] = [];
const imageBytes = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/k5sAAAAASUVORK5CYII="),
  (value) => value.charCodeAt(0),
);
window.viewerDialogFixture = { requests, writes };
window.fetch = async (input, init) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const url = new URL(raw, location.href);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  requests.push({ method, path: url.pathname });
  if (url.pathname === "/api/v1/files/content" && method === "GET")
    return new Response(imageBytes, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  writes.push({ method, path: url.pathname });
  return new Response(null, { status: 204 });
};

await initializeLanguage("en");
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.documentElement.dataset.surface = params.get("surface") ?? "solid";
const style = document.createElement("link");
style.rel = "stylesheet";
style.href = "/api/v1/module-assets/viewers/index.css";
document.head.append(style);
await new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "/api/v1/module-assets/viewers/index.js";
  script.onload = () => resolve();
  script.onerror = () => reject(Error("Built viewers bundle failed to load"));
  document.head.append(script);
});
const definition = modules().find((module) => module.id === "viewers");
const Viewer = definition?.fileViewer?.component;
if (!Viewer) throw Error("Viewers file viewer did not register");
const entry = {
  name: "synthetic-image.png",
  path: "/synthetic/image.png",
  size: imageBytes.length,
  revision: "fixture-revision",
};
function Fixture() {
  const [open, setOpen] = useState(true);
  return open ? (
    <Viewer
      entry={entry}
      siblings={[entry]}
      readOnly={false}
      open={() => setOpen(true)}
      close={() => setOpen(false)}
      saved={() => {}}
    />
  ) : (
    <button type="button" onClick={() => setOpen(true)}>
      Reopen synthetic image
    </button>
  );
}
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Fixture />
  </QueryClientProvider>,
);

declare global {
  interface Window {
    viewerDialogFixture: {
      requests: { method: string; path: string }[];
      writes: { method: string; path: string }[];
    };
  }
}
