// Builds small, valid PDF files for the Week 7 tests (no dependencies).
//
// buildPdf(["page 1 text", "page 2 text"])  -> text PDF, one string per page
// buildPdf([null])                          -> a page with only a filled
//                                              rectangle: like a scanned image,
//                                              there is NO text layer at all.
// Text is drawn with the standard Helvetica font (ASCII only).

function escapePdfText(text) {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

function pageContent(text) {
  if (text === null) {
    return "0.85 g 72 200 450 500 re f\n0 g 90 220 m 500 680 l S\n";
  }

  // one PDF text line per source line, wrapped at ~90 characters
  const lines = [];
  for (const sourceLine of text.split("\n")) {
    let rest = sourceLine;
    do {
      let cut = rest.length <= 90 ? rest.length : rest.lastIndexOf(" ", 90);
      if (cut <= 0) cut = Math.min(90, rest.length);
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    } while (rest.length > 0);
  }

  const body = lines
    .map((line, index) => `${index === 0 ? "" : "0 -14 Td "}(${escapePdfText(line)}) Tj`)
    .join("\n");

  return `BT\n/F1 11 Tf\n50 780 Td\n${body}\nET\n`;
}

export function buildPdf(pageTexts) {
  const objects = [];
  const pageCount = pageTexts.length;
  const firstPageObject = 4;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pageTexts
    .map((_, index) => `${firstPageObject + index * 2} 0 R`)
    .join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  pageTexts.forEach((text, index) => {
    const pageObject = firstPageObject + index * 2;
    const content = pageContent(text);

    objects[pageObject] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`;
    objects[pageObject + 1] =
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`;
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];

  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = Buffer.byteLength(pdf, "latin1");
    pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let number = 1; number < objects.length; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
