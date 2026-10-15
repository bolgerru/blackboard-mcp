// Text and image extraction for course files, kept small enough to ship as a desktop extension:
// PDFs via unpdf (a trimmed pdf.js build), Office/OpenDocument files by unzipping them (fflate)
// and reading their XML. No OCR, no canvas.

import { unzipSync, strFromU8, zlibSync } from "fflate";

let unpdfModule;
const unpdf = async () => (unpdfModule ??= await import("unpdf"));

export const TEXT_EXTENSIONS = ["pdf", "pptx", "docx", "xlsx", "odt", "odp", "ods", "rtf", "txt", "md", "csv", "html", "htm"];
export const isTextFile = (name) => TEXT_EXTENSIONS.includes(extOf(name));
export const extOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

// ---------- helpers ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html) {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|pre)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const tidy = (s) => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const byNumber = (a, b) => (parseInt(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - parseInt(b.match(/(\d+)\.xml$/)?.[1] ?? 0));

// Text of one OOXML part: only text inside run elements (<w:t>/<a:t>) counts; paragraphs end lines,
// table cells are separated by " | ", tabs and breaks are kept.
function ooxmlText(xml, { para, run }) {
  let out = "";
  let inRun = false;
  for (const m of xml.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>|([^<]+)/g)) {
    const [, closing, tag, selfClosing, text] = m;
    if (text !== undefined) {
      if (inRun) out += text;
      continue;
    }
    if (tag === run) inRun = !closing && !selfClosing;
    else if (closing && tag === para) out += "\n";
    else if (closing && tag === "w:tc") out += " | ";
    else if (tag === "w:tab" || tag === "a:tab") out += "\t";
    else if ((tag === "w:br" || tag === "a:br") && !closing) out += "\n";
  }
  return decodeEntities(out);
}

function unzip(buf) {
  return unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

// ---------- text ----------

export async function extractText(buf, fileName) {
  const ext = extOf(fileName);
  switch (ext) {
    case "txt":
    case "md":
    case "csv":
      return buf.toString("utf8");
    case "html":
    case "htm":
      return htmlToText(buf.toString("utf8"));
    case "pdf": {
      const { getDocumentProxy, extractText: pdfText } = await unpdf();
      const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
      try {
        const { text } = await pdfText(pdf, { mergePages: false });
        return tidy(text.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join("\n\n"));
      } finally {
        await pdf.destroy?.();
      }
    }
    case "docx": {
      const z = unzip(buf);
      const parts = ["word/document.xml", ...Object.keys(z).filter((k) => /^word\/(footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(k))];
      return tidy(parts.filter((p) => z[p]).map((p) => ooxmlText(strFromU8(z[p]), { para: "w:p", run: "w:t" })).join("\n"));
    }
    case "pptx": {
      const z = unzip(buf);
      const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort(byNumber);
      return tidy(
        slides
          .map((s, i) => {
            const n = s.match(/slide(\d+)\.xml$/)[1];
            const body = ooxmlText(strFromU8(z[s]), { para: "a:p", run: "a:t" });
            const notesFile = `ppt/notesSlides/notesSlide${n}.xml`;
            const notes = z[notesFile] ? ooxmlText(strFromU8(z[notesFile]), { para: "a:p", run: "a:t" }).replace(/^\s*\d+\s*$/m, "").trim() : "";
            return `--- Slide ${i + 1} ---\n${body}${notes ? `\n[Notes] ${notes}` : ""}`;
          })
          .join("\n\n")
      );
    }
    case "xlsx": {
      const z = unzip(buf);
      const shared = z["xl/sharedStrings.xml"]
        ? [...strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
            decodeEntities([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
          )
        : [];
      const sheets = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort(byNumber);
      return tidy(
        sheets
          .map((s, i) => {
            const rows = [...strFromU8(z[s]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
              [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
                .map(([, attrs, inner = ""]) => {
                  const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
                  if (/t="s"/.test(attrs) && v != null) return shared[+v] ?? "";
                  const inline = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1];
                  return decodeEntities(inline ?? v ?? "");
                })
                .filter((c) => c !== "")
                .join(" | ")
            );
            return `--- Sheet ${i + 1} ---\n${rows.filter(Boolean).join("\n")}`;
          })
          .join("\n\n")
      );
    }
    case "odt":
    case "odp":
    case "ods": {
      const z = unzip(buf);
      const xml = z["content.xml"] ? strFromU8(z["content.xml"]) : "";
      return tidy(
        decodeEntities(
          xml
            .replace(/<text:tab\/>/g, "\t")
            .replace(/<text:line-break\/>/g, "\n")
            .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (m, n) => " ".repeat(+n || 1))
            .replace(/<\/text:(p|h)>/g, "\n")
            .replace(/<\/table:table-cell>/g, " | ")
            .replace(/<[^>]+>/g, "")
        )
      );
    }
    case "rtf": {
      const s = buf.toString("latin1");
      return tidy(
        s
          .replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\par[d]?\b ?/g, "\n")
          .replace(/\{\\\*[^{}]*\}/g, "")
          .replace(/\\[a-z]+-?\d* ?/gi, "")
          .replace(/[{}]/g, "")
      );
    }
    default:
      throw new Error(`Can't read text from .${ext} files`);
  }
}

// ---------- images ----------

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

/**
 * Images embedded in a file, as [{ name, mimeType, data: Buffer }]. Office files give their
 * original pictures; PDF images are re-encoded as PNG.
 */
export async function extractImages(buf, fileName) {
  const ext = extOf(fileName);
  if (["pptx", "docx", "xlsx", "odt", "odp", "ods"].includes(ext)) {
    const z = unzip(buf);
    return Object.keys(z)
      .filter((k) => /^(ppt|word|xl)\/media\/|^Pictures\//.test(k) && MIME[extOf(k)])
      .sort(byNumber)
      .map((k) => ({ name: k.split("/").pop(), mimeType: MIME[extOf(k)], data: Buffer.from(z[k]) }));
  }
  if (ext === "pdf") {
    const { getDocumentProxy, extractImages: pdfImages } = await unpdf();
    const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
    const out = [];
    try {
      for (let p = 1; p <= pdf.numPages; p++) {
        let imgs = [];
        try {
          imgs = await pdfImages(pdf, p);
        } catch {
          continue;
        }
        imgs.forEach((img, i) => {
          if (img.width < 16 || img.height < 16) return;
          out.push({ name: `page${p}_${i + 1}.png`, mimeType: "image/png", data: encodePng(img), page: p });
        });
      }
    } finally {
      await pdf.destroy?.();
    }
    return out;
  }
  throw new Error(`Can't read images from .${ext} files`);
}

// Minimal PNG encoder for raw pixels (1 = grey, 3 = RGB, 4 = RGBA channels).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng({ data, width, height, channels }) {
  const colorType = { 1: 0, 3: 2, 4: 6 }[channels];
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); // filter byte 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
