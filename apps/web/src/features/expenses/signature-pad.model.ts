import { findOpaqueBounds } from './expenses.model';

export type SignaturePoint = Readonly<{ x: number; y: number }>;
export type SignatureStroke = readonly SignaturePoint[];

export type SignatureCropBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function isSignaturePadEmpty(strokes: readonly SignatureStroke[]): boolean {
  return strokes.every((stroke) => stroke.length === 0);
}

export function findSignatureCropBounds(
  imageData: ImageData,
  padding = 0,
): SignatureCropBounds | null {
  const bounds = findOpaqueBounds(imageData);
  if (!bounds) return null;
  const safePadding = Math.max(0, Math.floor(padding));
  const x = Math.max(0, bounds.x - safePadding);
  const y = Math.max(0, bounds.y - safePadding);
  const right = Math.min(imageData.width, bounds.x + bounds.width + safePadding);
  const bottom = Math.min(imageData.height, bounds.y + bounds.height + safePadding);
  return { x, y, width: right - x, height: bottom - y };
}
