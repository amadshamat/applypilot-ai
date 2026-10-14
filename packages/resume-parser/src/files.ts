import { MAX_RESUME_BYTES, RESUME_MIME_TYPES } from '@applypilot/shared';

/**
 * Text extraction from resume files. Both libraries are large, so they are
 * loaded only when a file is actually parsed. Everything runs locally; the file
 * never leaves the browser.
 */

export type ResumeMimeType = (typeof RESUME_MIME_TYPES)[keyof typeof RESUME_MIME_TYPES];

export class ResumeFileError extends Error {
  override readonly name = 'ResumeFileError';
}

/** Identifies the format from the MIME type, falling back to the extension (some systems send ''). */
export function detectResumeType(fileName: string, mimeType: string): ResumeMimeType | null {
  if (mimeType === RESUME_MIME_TYPES.pdf || /\.pdf$/i.test(fileName)) return RESUME_MIME_TYPES.pdf;
  if (mimeType === RESUME_MIME_TYPES.docx || /\.docx$/i.test(fileName))
    return RESUME_MIME_TYPES.docx;
  return null;
}

/** Checks the type and size and returns a reason the file cannot be used, or null. */
export function validateResumeFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!detectResumeType(file.name, file.type)) {
    return /\.doc$/i.test(file.name)
      ? 'Old Word (.doc) files are not supported. Save it as .docx or PDF and try again.'
      : 'Only PDF and Word (.docx) files are supported.';
  }
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_RESUME_BYTES) return 'This file is larger than 5 MB.';
  return null;
}

export interface ExtractOptions {
  /** URL of pdf.worker.min.mjs. In the extension this is chrome.runtime.getURL(...). */
  pdfWorkerSrc?: string;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

/** Rebuilds lines from positioned PDF text runs. */
export function pdfItemsToLines(items: readonly PdfTextItem[]): string[] {
  const lines: string[] = [];
  let line = '';
  let lastY: number | null = null;
  let lastEndX = 0;
  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 2) {
      lines.push(line);
      line = '';
    } else if (
      line.length > 0 &&
      item.str.length > 0 &&
      !/\s$/.test(line) &&
      !/^\s/.test(item.str)
    ) {
      // A visible horizontal gap between runs on the same line means a space (or a column gap).
      const gap = x - lastEndX;
      if (gap > 12) line += '   ';
      else if (gap > 1) line += ' ';
    }
    line += item.str;
    if (item.str.length > 0) {
      lastY = y;
      lastEndX = x + item.width;
    }
    if (item.hasEOL) {
      lines.push(line);
      line = '';
      lastY = null;
    }
  }
  if (line) lines.push(line);
  return lines.map((text) => text.trimEnd());
}

async function extractPdfText(data: ArrayBuffer, options: ExtractOptions): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (options.pdfWorkerSrc) pdfjs.GlobalWorkerOptions.workerSrc = options.pdfWorkerSrc;
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: false,
  });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 20); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item) => 'str' in item) as PdfTextItem[];
      pages.push(pdfItemsToLines(items).join('\n'));
      page.cleanup();
    }
    return pages.join('\n');
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new ResumeFileError(
        'This PDF is password-protected. Remove the password and try again.',
      );
    }
    throw new ResumeFileError('This PDF could not be read. It may be damaged.');
  } finally {
    await task.destroy();
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Converts mammoth's small, predictable HTML into lines, keeping list items as bullets. */
export function docxHtmlToText(html: string): string {
  return html
    .replace(/<img[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|tr|ul|ol|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '   ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocxText(data: ArrayBuffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  try {
    // The browser build reads `arrayBuffer`, the Node build (tests) reads `buffer`.
    const input = { arrayBuffer: data, buffer: data } as unknown as { arrayBuffer: ArrayBuffer };
    const result = await mammoth.convertToHtml(input);
    return docxHtmlToText(result.value);
  } catch {
    throw new ResumeFileError(
      'This Word document could not be read. It may be damaged or not a .docx file.',
    );
  }
}

/** Extracts plain text from a PDF or DOCX resume. */
export async function extractResumeText(
  data: ArrayBuffer,
  mimeType: ResumeMimeType,
  options: ExtractOptions = {},
): Promise<string> {
  const text =
    mimeType === RESUME_MIME_TYPES.pdf
      ? await extractPdfText(data, options)
      : await extractDocxText(data);
  if (text.replace(/\s/g, '').length < 20) {
    throw new ResumeFileError(
      mimeType === RESUME_MIME_TYPES.pdf
        ? 'No selectable text was found. This PDF may be a scanned image, which is not supported yet. Try the Word version, or a PDF exported from a text editor.'
        : 'This document does not contain any text.',
    );
  }
  return text;
}
