'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { cx } from '@/common/components/mangmee';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { btnClass, ghostClass } from './ExpensesUi';
import {
  findSignatureCropBounds,
  isSignaturePadEmpty,
  type SignaturePoint,
} from './signature-pad.model';

const STROKE_WIDTH = 2.5;
const CROP_PADDING = 8;

export function SignaturePad({
  busy,
  onChange,
  onConfirm,
}: {
  busy: boolean;
  /** Reports whether the pad now holds unconfirmed strokes, so the caller can keep submit blocked. */
  onChange: (hasStrokes: boolean) => void;
  onConfirm: (file: File, preview: { original: string; cleaned: string }) => void;
}) {
  const locale = useWorkspaceLocale();
  const instructionId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<SignaturePoint[][]>([]);
  const activePointerRef = useRef<number | null>(null);
  const [empty, setEmpty] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#111';
    context.fillStyle = '#111';
    context.lineWidth = STROKE_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      if (stroke.length === 1) {
        const point = stroke[0]!;
        context.beginPath();
        context.arc(point.x * width, point.y * height, STROKE_WIDTH / 2, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      if (stroke.length < 2) continue;
      context.beginPath();
      context.moveTo(stroke[0]!.x * width, stroke[0]!.y * height);
      for (const point of stroke.slice(1)) context.lineTo(point.x * width, point.y * height);
      context.stroke();
    }
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    paint();
  }, [paint]);

  useEffect(() => {
    resizeCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    window.addEventListener('resize', resizeCanvas);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [resizeCanvas]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): SignaturePoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy || exporting || activePointerRef.current !== null
      || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    strokesRef.current.push([pointFromEvent(event)]);
    setEmpty(isSignaturePadEmpty(strokesRef.current));
    setError(null);
    onChange(!isSignaturePadEmpty(strokesRef.current));
    paint();
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    strokesRef.current.at(-1)?.push(pointFromEvent(event));
    paint();
  };

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerRef.current = null;
  };

  const clear = () => {
    strokesRef.current = [];
    activePointerRef.current = null;
    setEmpty(true);
    setError(null);
    onChange(false);
    paint();
  };

  const confirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || isSignaturePadEmpty(strokesRef.current)) return;
    const context = canvas.getContext('2d');
    if (!context) {
      setError(t('expenses.substitute_wizard.signature_unsupported', locale));
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const ratio = window.devicePixelRatio || 1;
      const bounds = findSignatureCropBounds(
        context.getImageData(0, 0, canvas.width, canvas.height),
        Math.ceil(CROP_PADDING * ratio),
      );
      if (!bounds) throw new Error(t('expenses.substitute_wizard.signature_empty', locale));
      const output = document.createElement('canvas');
      output.width = bounds.width;
      output.height = bounds.height;
      const outputContext = output.getContext('2d');
      if (!outputContext) throw new Error(t('expenses.substitute_wizard.signature_unsupported', locale));
      outputContext.drawImage(
        canvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(t('expenses.substitute_wizard.signature_create_failed', locale));
      onConfirm(new File([blob], 'signature.png', { type: 'image/png' }), {
        original: canvas.toDataURL('image/png'),
        cleaned: output.toDataURL('image/png'),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('expenses.substitute_wizard.signature_create_failed', locale));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p id={instructionId} className="text-sm text-gray-600">
        {t('expenses.substitute_wizard.signature_draw_instruction', locale)}
      </p>
      <div className="relative overflow-hidden rounded-xl border border-gray-300 bg-white">
        <div aria-hidden className="pointer-events-none absolute inset-x-5 top-3/4 border-t border-gray-300" />
        <canvas
          ref={canvasRef}
          className={cx('relative block h-44 w-full touch-none', (busy || exporting) && 'cursor-not-allowed opacity-60')}
          aria-label={t('expenses.substitute_wizard.signature_canvas_label', locale)}
          aria-describedby={instructionId}
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      </div>
      {error && <p role="alert" className="text-sm text-error-700">{error}</p>}
      {/* One size, the way back first and the acting one last. The drawing is used only on this press, never by itself. */}
      <ActionGroup>
        <button type="button" className={ghostClass} disabled={busy || exporting || empty} onClick={clear}>
          {t('expenses.substitute_wizard.signature_clear', locale)}
        </button>
        <button type="button" className={btnClass} disabled={busy || exporting || empty} aria-busy={Boolean(busy || exporting)} onClick={() => void confirm()}>
          {t('expenses.substitute_wizard.signature_use_drawing', locale)}
        </button>
      </ActionGroup>
    </div>
  );
}
