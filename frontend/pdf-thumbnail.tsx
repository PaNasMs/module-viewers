import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// Render nearby previews one at a time alongside the main page.
const pending = new WeakMap<PDFDocumentProxy, Promise<void>>();

export function PdfThumbnail({
  pdf,
  page,
}: {
  pdf: PDFDocumentProxy;
  page: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    let active = true;
    let task: RenderTask | undefined;
    async function draw() {
      if (!active) return;
      const p = await pdf.getPage(page);
      if (!active) return;
      const size = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({
        scale: Math.min(128 / size.width, 128 / size.height),
      });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      task = p.render({ canvas, viewport });
      await task.promise;
      if (active) canvas.hidden = false;
    }
    const previous = pending.get(pdf) ?? Promise.resolve();
    pending.set(
      pdf,
      previous.then(draw).catch(() => {
        // A failed thumbnail leaves the numbered page button usable.
      }),
    );
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page]);
  return <canvas ref={ref} hidden aria-hidden="true" />;
}
