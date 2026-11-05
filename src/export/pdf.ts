import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../model/page";

/** Landscape A4 in PDF points. */
export const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const MARGIN = 24;
const HEADER_H = 30;
const FOOTER_H = 26;
const SMALL = 9;

/** Colours for the page around the image, from the export theme's tokens. */
export type PdfColours = { background: string; text: string; muted: string };

export type Fonts = { regular: PDFFont; bold: PDFFont };

export async function newPdf(title: string): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Engineer's Notebook");
  doc.setProducer("Engineer's Notebook");
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  return { doc, fonts };
}

export function hexToRgb(colour: string): RGB {
  const m = colour.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return rgb(0, 0, 0);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** The standard PDF fonts only cover Windows-1252, so anything else becomes "?". */
export function safeText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.replace(/[\r\n\t]+/g, " ")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function fitWidth(font: PDFFont, text: string, size: number, max: number): string {
  let t = safeText(font, text);
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Where the page image goes: as large as fits between header and footer, centred. */
export function imageBox(): { x: number; y: number; w: number; h: number } {
  const [W, H] = A4_LANDSCAPE;
  const maxW = W - MARGIN * 2;
  const maxH = H - HEADER_H - FOOTER_H - MARGIN;
  const ratio = PAGE_WIDTH / PAGE_HEIGHT;
  const w = Math.min(maxW, maxH * ratio);
  const h = w / ratio;
  return { x: (W - w) / 2, y: FOOTER_H + (maxH - h) / 2 + MARGIN / 2, w, h };
}

function background(page: PDFPage, colours: PdfColours) {
  const [W, H] = A4_LANDSCAPE;
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hexToRgb(colours.background) });
}

function footer(page: PDFPage, fonts: Fonts, colours: PdfColours, n: number, total: number) {
  const [W] = A4_LANDSCAPE;
  const label = `Page ${n} of ${total}`;
  const w = fonts.regular.widthOfTextAtSize(label, SMALL);
  page.drawText(label, {
    x: (W - w) / 2,
    y: 12,
    size: SMALL,
    font: fonts.regular,
    color: hexToRgb(colours.muted),
  });
}

export type NotebookPageMeta = { tabName: string; pageTitle: string; created: string };

/** One notebook page: slim header (tab, title, created date), the page image, page number. */
export async function addNotebookPage(
  doc: PDFDocument,
  fonts: Fonts,
  png: Uint8Array,
  meta: NotebookPageMeta,
  colours: PdfColours,
  n: number,
  total: number,
) {
  const [W, H] = A4_LANDSCAPE;
  const page = doc.addPage(A4_LANDSCAPE);
  background(page, colours);
  const y = H - MARGIN + 2 - SMALL;
  const right = `Started ${meta.created}`;
  const rightW = fonts.regular.widthOfTextAtSize(safeText(fonts.regular, right), SMALL);
  const tab = fitWidth(fonts.bold, meta.tabName, SMALL, 220);
  const tabW = fonts.bold.widthOfTextAtSize(tab, SMALL);
  page.drawText(tab, {
    x: MARGIN,
    y,
    size: SMALL,
    font: fonts.bold,
    color: hexToRgb(colours.text),
  });
  const title = fitWidth(
    fonts.regular,
    `  ·  ${meta.pageTitle || "Untitled page"}`,
    SMALL,
    W - MARGIN * 2 - tabW - rightW - 20,
  );
  page.drawText(title, {
    x: MARGIN + tabW,
    y,
    size: SMALL,
    font: fonts.regular,
    color: hexToRgb(colours.text),
  });
  page.drawText(safeText(fonts.regular, right), {
    x: W - MARGIN - rightW,
    y,
    size: SMALL,
    font: fonts.regular,
    color: hexToRgb(colours.muted),
  });

  const img = await doc.embedPng(png);
  const box = imageBox();
  page.drawImage(img, { x: box.x, y: box.y, width: box.w, height: box.h });
  footer(page, fonts, colours, n, total);
}

export const CONTENTS_PER_PAGE = 24;
export const contentsPageCount = (entries: number) =>
  Math.max(1, Math.ceil(entries / CONTENTS_PER_PAGE));

/** Contents page(s) for a tab's combined PDF, inserted at the front. */
export function insertContents(
  doc: PDFDocument,
  fonts: Fonts,
  colours: PdfColours,
  heading: string,
  subheading: string,
  entries: { title: string; created: string; pageNumber: number }[],
  total: number,
) {
  const [W, H] = A4_LANDSCAPE;
  const pages = contentsPageCount(entries.length);
  for (let p = 0; p < pages; p++) {
    const page = doc.insertPage(p, A4_LANDSCAPE);
    background(page, colours);
    let y = H - MARGIN - 40;
    if (p === 0) {
      page.drawText(fitWidth(fonts.bold, heading, 22, W - MARGIN * 4), {
        x: MARGIN * 2,
        y,
        size: 22,
        font: fonts.bold,
        color: hexToRgb(colours.text),
      });
      y -= 24;
      page.drawText(safeText(fonts.regular, subheading), {
        x: MARGIN * 2,
        y,
        size: 11,
        font: fonts.regular,
        color: hexToRgb(colours.muted),
      });
      y -= 36;
    } else {
      y -= 10;
    }
    for (const e of entries.slice(p * CONTENTS_PER_PAGE, (p + 1) * CONTENTS_PER_PAGE)) {
      const num = String(e.pageNumber);
      const numW = fonts.regular.widthOfTextAtSize(num, 11);
      const date = safeText(fonts.regular, e.created);
      const dateW = fonts.regular.widthOfTextAtSize(date, 11);
      page.drawText(
        fitWidth(fonts.regular, e.title || "Untitled page", 11, W - MARGIN * 4 - numW - dateW - 40),
        {
          x: MARGIN * 2,
          y,
          size: 11,
          font: fonts.regular,
          color: hexToRgb(colours.text),
        },
      );
      page.drawText(date, {
        x: W - MARGIN * 2 - numW - 24 - dateW,
        y,
        size: 11,
        font: fonts.regular,
        color: hexToRgb(colours.muted),
      });
      page.drawText(num, {
        x: W - MARGIN * 2 - numW,
        y,
        size: 11,
        font: fonts.regular,
        color: hexToRgb(colours.text),
      });
      y -= 18;
    }
    footer(page, fonts, colours, p + 1, total);
  }
}

/** A plain text document, wrapped across landscape A4 pages (used for Reminders.pdf). */
export async function textPdf(
  title: string,
  sections: { heading: string; note?: string; lines: string[] }[],
  colours: PdfColours,
): Promise<Uint8Array> {
  const { doc, fonts } = await newPdf(title);
  const [W, H] = A4_LANDSCAPE;
  const maxW = W - MARGIN * 4;
  let page = doc.addPage(A4_LANDSCAPE);
  background(page, colours);
  let y = H - MARGIN - 40;
  const need = (h: number) => {
    if (y - h < FOOTER_H + 10) {
      page = doc.addPage(A4_LANDSCAPE);
      background(page, colours);
      y = H - MARGIN - 20;
    }
  };
  const draw = (text: string, size: number, font: PDFFont, colour: string, indent = 0) => {
    const words = safeText(font, text).split(" ");
    let line = "";
    const flush = () => {
      need(size + 6);
      page.drawText(line, { x: MARGIN * 2 + indent, y, size, font, color: hexToRgb(colour) });
      y -= size + 6;
      line = "";
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW - indent && line) {
        flush();
        line = w;
      } else line = next;
    }
    if (line) flush();
  };
  draw(title, 22, fonts.bold, colours.text);
  y -= 8;
  for (const s of sections) {
    need(40);
    y -= 6;
    draw(s.heading, 14, fonts.bold, colours.text);
    if (s.note) draw(s.note, 10, fonts.regular, colours.muted);
    for (const l of s.lines) draw(l, 11, fonts.regular, colours.text, 12);
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => footer(p, fonts, colours, i + 1, pages.length));
  return doc.save();
}
