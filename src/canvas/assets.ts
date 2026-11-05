import { useEffect, useState } from "react";
import { backend } from "../storage/backend";

/** Pasted images are placed no wider than this (SPEC: Paste and other shortcuts). */
export const MAX_IMAGE_WIDTH = 800;

const cache = new Map<string, Promise<HTMLImageElement>>();
const key = (notesPath: string, rel: string) => `${notesPath}|${rel}`;

function loadFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = url;
  });
}

export function loadAsset(notesPath: string, rel: string): Promise<HTMLImageElement> {
  const k = key(notesPath, rel);
  let p = cache.get(k);
  if (!p) {
    p = backend
      .readAsset(notesPath, rel)
      .then((buf) => loadFromUrl(URL.createObjectURL(new Blob([buf], { type: "image/png" }))));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
  }
  return p;
}

export function useAsset(notesPath: string, rel: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let live = true;
    loadAsset(notesPath, rel).then(
      (i) => live && setImg(i),
      () => live && setImg(null),
    );
    return () => {
      live = false;
    };
  }, [notesPath, rel]);
  return img;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * Converts any browser-readable image to PNG, stores it in `assets/` (de-duplicated
 * by hash on the Rust side) and returns its path and natural size.
 */
export async function importImage(
  notesPath: string,
  blob: Blob,
): Promise<{ rel: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not convert the image"))),
      "image/png",
    ),
  );
  const rel = await backend.saveAsset(notesPath, toBase64(await png.arrayBuffer()));
  const k = key(notesPath, rel);
  if (!cache.has(k)) cache.set(k, loadFromUrl(URL.createObjectURL(png)));
  return { rel, width: canvas.width, height: canvas.height };
}

/** Placed size: at most MAX_IMAGE_WIDTH wide, keeping the aspect ratio. */
export function placedSize(width: number, height: number): { w: number; h: number } {
  const w = Math.min(MAX_IMAGE_WIDTH, width);
  return { w, h: Math.round((height * w) / width) };
}
