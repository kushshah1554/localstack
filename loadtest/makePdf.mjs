// Builds a valid, uncompressed text PDF (same approach as server/src/modules/pdfs/pdfs.test.ts).
// Run directly to write loadtest/sample.pdf for k6:  node loadtest/makePdf.mjs
import { writeFileSync } from 'node:fs';

export function makePdf(pageCount) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids = [];
  for (let i = 0; i < pageCount; i++) {
    const page = objects.length + 1;
    const lines = Array.from({ length: 40 }, (_, n) => `(Page ${i + 1}, line ${n + 1} of the sample report) Tj 0 -16 Td`);
    const text = `BT /F1 12 Tf 72 740 Td ${lines.join(' ')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`);
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(`${page} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('./sample.pdf', import.meta.url), makePdf(25));
  console.log('Wrote loadtest/sample.pdf');
}
