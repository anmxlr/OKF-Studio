import fs from 'fs';
import path from 'path';

export async function parseText(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const ext = path.extname(filePath).toLowerCase();

  return {
    text: text,
    pages: [
      { pageNumber: 1, text: text }
    ],
    metadata: {
      fileType: ext,
      pageCount: 1,
      wordCount
    }
  };
}
