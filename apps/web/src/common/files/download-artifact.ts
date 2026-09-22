/**
 * Saves a server-rendered artifact (base64 bytes + mime type + file name, e.g. `TaxExportArtifact`)
 * as a browser download. For bytes the server already produced — contrast `downloadDocumentAsPdf`
 * (`download-document-pdf.ts`), which rasterizes an on-screen SVG because the API has no Thai font.
 */
export function downloadArtifact(artifact: { contentBase64: string; mimeType: string; fileName: string }): void {
  const bytes = Uint8Array.from(atob(artifact.contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.fileName;
  a.click();
  URL.revokeObjectURL(url);
}
