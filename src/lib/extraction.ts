import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

export type ExtractedContent = {
  text: string;
  pageCount?: number;
};

export const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MIME_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MIME_PDF = "application/pdf";

export const SUPPORTED_UPLOAD_MIMES = [MIME_PDF, MIME_DOCX, MIME_PPTX, MIME_XLSX] as const;
export const MIMES_NEEDING_EXTRACTION = new Set([MIME_DOCX, MIME_PPTX, MIME_XLSX]);

export function humanLabel(mime: string): string {
  switch (mime) {
    case MIME_PDF:
      return "PDF";
    case MIME_DOCX:
      return "Word";
    case MIME_PPTX:
      return "PowerPoint";
    case MIME_XLSX:
      return "Excel";
    default:
      return mime;
  }
}

export async function extractText(bytes: Buffer, mimeType: string): Promise<ExtractedContent> {
  switch (mimeType) {
    case MIME_DOCX:
      return extractDocx(bytes);
    case MIME_PPTX:
      return extractPptx(bytes);
    case MIME_XLSX:
      return extractXlsx(bytes);
    default:
      throw new Error(`No extractor for mime type: ${mimeType}`);
  }
}

async function extractDocx(bytes: Buffer): Promise<ExtractedContent> {
  const result = await mammoth.extractRawText({ buffer: bytes });
  const text = result.value.trim();
  if (!text) throw new Error("No text could be extracted from this Word document.");
  return { text };
}

/**
 * Excel: each sheet becomes a CSV block with a clear header. Formula cells
 * resolve to their cached values. Value lookup only — we do not re-execute the
 * model.
 */
async function extractXlsx(bytes: Buffer): Promise<ExtractedContent> {
  const workbook = XLSX.read(bytes, { type: "buffer", cellFormula: false, cellDates: true });
  const sections: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length === 0) continue;
    sections.push(`=== Sheet: ${sheetName} ===\n${csv.trim()}`);
  }
  if (sections.length === 0) throw new Error("Workbook is empty or unreadable.");
  return { text: sections.join("\n\n"), pageCount: workbook.SheetNames.length };
}

/**
 * PPTX: unzip and pull text runs (<a:t> elements) from each slide's XML.
 * Preserves slide order and labels each section by slide number.
 */
async function extractPptx(bytes: Buffer): Promise<ExtractedContent> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  if (slideFiles.length === 0) throw new Error("No slides found in PPTX.");

  const slides: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const file = zip.file(slideFiles[i]);
    if (!file) continue;
    const xml = await file.async("string");
    const runs = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)).map((m) =>
      decodeXmlEntities(m[1])
    );
    const slideText = runs.join(" ").replace(/\s+/g, " ").trim();
    if (slideText) slides.push(`=== Slide ${i + 1} ===\n${slideText}`);
  }

  if (slides.length === 0) throw new Error("PPTX contained no extractable text.");
  return { text: slides.join("\n\n"), pageCount: slideFiles.length };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)));
}
