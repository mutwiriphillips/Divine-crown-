import type { DocSnapshot } from "@/lib/documents";
import { loadDocumentForViewer } from "@/lib/document-access";
import { renderDocumentPdf } from "@/lib/pdf";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadDocumentForViewer(id, new URL(req.url).searchParams.get("key"));
  if (!loaded) return new Response("Not found", { status: 404 });
  const pdf = await renderDocumentPdf(loaded.doc.snapshot as DocSnapshot);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${loaded.doc.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
