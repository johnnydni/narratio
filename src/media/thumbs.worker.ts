/// <reference lib="webworker" />
/**
 * Rechnet Vorschaubilder außerhalb des Hauptthreads (Tipp-Budget unter 50 ms).
 * Drei Größen nach längster Kante, nie hochskaliert; WebP, wo der Browser es kodieren kann,
 * sonst JPEG. Dazu die mittlere Farbe als Platzhalter.
 */
const SIZES = { s: 160, m: 480, l: 1280 } as const;

async function encode(canvas: OffscreenCanvas): Promise<Blob> {
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  // Safari kodiert kein WebP und liefert stillschweigend PNG; das ist für Fotos zu groß.
  if (webp.type === 'image/webp') return webp;
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

function averageColor(bmp: ImageBitmap): string {
  const c = new OffscreenCanvas(1, 1);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  try {
    const bmp = await createImageBitmap(blob);
    const longest = Math.max(bmp.width, bmp.height);
    const thumbs: Record<string, Blob> = {};
    for (const [name, max] of Object.entries(SIZES)) {
      const scale = Math.min(1, max / longest);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, w, h);
      thumbs[name] = await encode(canvas);
    }
    const info = { width: bmp.width, height: bmp.height, color: averageColor(bmp), thumbs };
    bmp.close();
    (self as unknown as Worker).postMessage({ id, info });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
