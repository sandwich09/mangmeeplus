'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/common/components/modal';

export type DocumentPreviewSource = {
  name: string;
  mimeType: string;
  url: string;
};

export type DocumentPreviewKind = 'image' | 'pdf' | 'unsupported';

export type DocumentPreviewModalProps = {
  source: DocumentPreviewSource;
  imagePageUrls?: string[];
  closeLabel: string;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  openNewTabLabel: string;
  onClose: () => void;
  onRetry?: () => void | Promise<void>;
  onViewed?: () => void;
  footer?: ReactNode;
  printSurface?: boolean;
  hideOpenNewTab?: boolean;
  zoomOutLabel?: string;
  zoomInLabel?: string;
  resetZoomLabel?: string;
};

const PREVIEW_LOAD_TIMEOUT_MS = 20_000;
const MIN_ZOOM = 75;
const MAX_ZOOM = 200;
const ZOOM_STEP = 25;

/** Only formats the product accepts or generates are allowed into a browser renderer. */
export function documentPreviewKind(mimeType: string): DocumentPreviewKind {
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/svg+xml') return 'image';
  return 'unsupported';
}

export function DocumentPreviewModal(props: DocumentPreviewModalProps) {
  const sourceKey = `${props.source.name}\u0000${props.source.mimeType}\u0000${props.source.url}\u0000${props.imagePageUrls?.join('\u0000') ?? ''}`;
  // A keyed child resets loading/error/zoom/viewed state synchronously when the source changes.
  return <DocumentPreviewModalContent key={sourceKey} {...props} />;
}

function DocumentPreviewModalContent({
  source,
  imagePageUrls,
  closeLabel,
  loadingLabel,
  errorLabel,
  retryLabel,
  openNewTabLabel,
  onClose,
  onRetry,
  onViewed,
  footer,
  printSurface = false,
  hideOpenNewTab = false,
  zoomOutLabel = 'Zoom out',
  zoomInLabel = 'Zoom in',
  resetZoomLabel = 'Reset zoom',
}: DocumentPreviewModalProps) {
  const kind = documentPreviewKind(source.mimeType);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    kind === 'unsupported' || !source.url ? 'error' : 'loading',
  );
  const [mediaKey, setMediaKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [zoom, setZoom] = useState(100);
  const viewedRef = useRef(false);
  const loadedPagesRef = useRef(new Set<number>());
  const failedRef = useRef(false);
  const onViewedRef = useRef(onViewed);
  onViewedRef.current = onViewed;

  useEffect(() => {
    if (status !== 'loading' || kind === 'unsupported' || !source.url) return undefined;
    const timeout = window.setTimeout(() => { failedRef.current = true; setStatus('error'); }, PREVIEW_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [kind, mediaKey, source.url, status]);

  const handleMediaLoad = () => {
    if (failedRef.current) return;
    setStatus('ready');
    if (viewedRef.current) return;
    viewedRef.current = true;
    onViewedRef.current?.();
  };

  const handleMediaError = () => { failedRef.current = true; setStatus('error'); };
  const handlePageLoad = (index: number) => {
    loadedPagesRef.current.add(index);
    if (loadedPagesRef.current.size === imagePageUrls?.length) handleMediaLoad();
  };

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry?.();
      loadedPagesRef.current.clear();
      failedRef.current = false;
      setMediaKey((current) => current + 1);
      setStatus('loading');
    } catch {
      setStatus('error');
    } finally {
      setRetrying(false);
    }
  };

  // Never navigate directly to an SVG blob/data URL. Rendering SVG through <img> keeps it in
  // image mode, while opening it as a document can execute active content in the blob's origin.
  const mayOpenNewTab = !hideOpenNewTab && kind !== 'unsupported' && source.mimeType.split(';', 1)[0]?.trim().toLowerCase() !== 'image/svg+xml';
  const mayPrintPages = printSurface && kind === 'image' && !!imagePageUrls?.length;
  const modalFooter = footer || mayOpenNewTab || mayPrintPages ? (
    <>
      {footer}
      {mayPrintPages && <button type="button" disabled={status !== 'ready'} onClick={() => window.print()}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">พิมพ์</button>}
      {mayOpenNewTab && source.url && (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:border-brand-300 hover:bg-brand-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {openNewTabLabel}
        </a>
      )}
    </>
  ) : undefined;

  return (
    <Modal
      open
      title={source.name}
      size="xl"
      closeLabel={closeLabel}
      onClose={onClose}
      footer={modalFooter}
      printSurface={printSurface}
      bodyScroll={false}
      bodyClassName="flex min-h-0 flex-col bg-gray-50 p-0"
    >
      <div className={`flex min-h-0 flex-1 flex-col${imagePageUrls?.length ? ' document-preview-layout' : ''}`}>
        {kind === 'image' && (
          <div className="modal-print-hide flex flex-shrink-0 items-center justify-end gap-1.5 border-b border-gray-200 bg-white px-3 py-2">
            <button
              type="button"
              aria-label={zoomOutLabel}
              title={zoomOutLabel}
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-lg font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label={resetZoomLabel}
              title={resetZoomLabel}
              onClick={() => setZoom(100)}
              className="inline-flex h-10 min-w-16 items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold tabular-nums text-gray-700 hover:bg-gray-50"
            >
              {zoom}%
            </button>
            <button
              type="button"
              aria-label={zoomInLabel}
              title={zoomInLabel}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-lg font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}

        <div className="document-preview-viewport relative min-h-0 flex-1 overflow-auto p-3 sm:p-5" data-preview-status={status}>
          {status === 'loading' && (
            <div className="absolute inset-0 z-10 flex min-h-64 items-center justify-center bg-gray-50/95" role="status" aria-live="polite">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 shadow-sm">
                <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                {loadingLabel}
              </div>
            </div>
          )}

          {status === 'error' ? (
            <div className="flex min-h-64 items-center justify-center text-center" role="alert">
              <div className="max-w-md rounded-xl border border-error-500/30 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-error-700">{errorLabel}</p>
                <button
                  type="button"
                  disabled={retrying || kind === 'unsupported' || !source.url} aria-busy={Boolean(retrying)}
                  onClick={() => void retry()}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {retrying ? loadingLabel : retryLabel}
                </button>
              </div>
            </div>
          ) : kind === 'image' && imagePageUrls?.length ? (
            <div className="document-preview-pages mx-auto w-full" style={{ width: `${zoom}%` }}>
              {imagePageUrls.map((url, index) => <div key={`${mediaKey}-${index}`} className="document-preview-page mb-4 last:mb-0">
                <p className="modal-print-hide mb-2 text-center text-xs text-gray-500">หน้า {index + 1} / {imagePageUrls.length}</p>
                {/* SVG stays in image mode; no active content is inserted into the document. */}
                <img src={url} alt={`${source.name} หน้า ${index + 1}`} onLoad={() => handlePageLoad(index)} onError={handleMediaError}
                  className={`mx-auto block h-auto w-full rounded-lg bg-white shadow-sm ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`} />
              </div>)}
            </div>
          ) : kind === 'image' ? (
            <div className="mx-auto flex min-h-full w-full items-start justify-center">
              <img
                key={mediaKey}
                src={source.url}
                alt={source.name}
                onLoad={handleMediaLoad}
                onError={handleMediaError}
                className={`h-auto max-w-none flex-none rounded-lg bg-white shadow-sm transition-opacity ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
                style={{ width: `${zoom}%` }}
              />
            </div>
          ) : kind === 'pdf' ? (
            <iframe
              key={mediaKey}
              src={source.url}
              title={source.name}
              onLoad={handleMediaLoad}
              onError={handleMediaError}
              className={`h-[calc(100dvh-12rem)] min-h-64 w-full rounded-lg border border-gray-200 bg-white transition-opacity sm:min-h-[28rem] ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
