import path from 'path';

import { parsePdf } from './pdf.js';
import { parseDocx } from './docx.js';
import { parseImage } from './image.js';
import { parseText } from './text.js';
import { parseOffice } from './office.js';
import { parsePptx } from './pptx.js';
import { parseMedia } from './media.js';

export async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  switch (ext) {
    case '.pdf':
      return await parsePdf(filePath);
      
    case '.docx':
      return await parseDocx(filePath);
      
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.tiff':
    case '.bmp':
    case '.webp':
      return await parseImage(filePath);
      
    case '.txt':
    case '.md':
    case '.json':
    case '.yaml':
    case '.yml':
      return await parseText(filePath);
      
    case '.csv':
    case '.xlsx':
    case '.xls':
      return await parseOffice(filePath);
      
    case '.pptx':
    case '.ppt':
      return await parsePptx(filePath);
      
    case '.mp3':
    case '.wav':
    case '.m4a':
    case '.mp4':
    case '.mov':
    case '.avi':
    case '.mkv':
      return await parseMedia(filePath);
      
    default:
      // Fallback to text parsing if possible, or simple representation
      try {
        return await parseText(filePath);
      } catch (err) {
        console.warn(`No specific parser for ${ext}, fallback text parsing failed. Using binary placeholder.`);
        return {
          text: `Binary file (${ext}) without text extraction.`,
          pages: [{ pageNumber: 1, text: `Binary file (${ext}) without text extraction.` }],
          metadata: { fileType: ext, wordCount: 0, pageCount: 1 }
        };
      }
  }
}
