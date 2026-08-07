import "./pdfjs-polyfill.mjs";
import { PDFParse } from "pdf-parse";

const TEXT_LIKE = new Set(["text/plain", "text/markdown", ""]);

export async function extractTextFromUpload({ buffer, mimeType, filename }) {
  const ext = (filename ?? "").toLowerCase().split(".").pop();

  if (mimeType === "application/pdf" || ext === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (TEXT_LIKE.has(mimeType) || ext === "txt" || ext === "md") {
    return buffer.toString("utf8");
  }

  throw new Error(`Unsupported file type${ext ? ` ".${ext}"` : ""}. Upload a PDF or a plain text/.md file — .docx isn't supported yet.`);
}
