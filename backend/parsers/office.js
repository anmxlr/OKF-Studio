import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

export async function parseOffice(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  const metadata = { fileType: ext, pageCount: 1 };

  if (ext === '.csv') {
    const rawText = fs.readFileSync(filePath, 'utf8');
    text = rawText;
    const lines = rawText.split('\n');
    metadata.rowCount = lines.length;
    metadata.wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  } else {
    // XLSX / XLS
    const workbook = XLSX.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    metadata.sheets = sheetNames;
    metadata.sheetCount = sheetNames.length;
    
    let combinedText = '';
    sheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      // Convert sheet cells to CSV representation
      const csv = XLSX.utils.sheet_to_csv(sheet);
      combinedText += `## Sheet: ${sheetName}\n\n${csv}\n\n`;
    });
    
    text = combinedText;
    metadata.wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  }

  return {
    text: text,
    pages: [
      { pageNumber: 1, text: text }
    ],
    metadata
  };
}
