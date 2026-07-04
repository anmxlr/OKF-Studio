import fs from 'fs';
import path from 'path';

export async function parseMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stats = fs.statSync(filePath);
  
  const text = `Media File: ${path.basename(filePath)}
Type: ${ext}
Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB
Created: ${stats.birthtime.toISOString()}
This is an audio/video media asset uploaded to the workspace.`;

  return {
    text: text,
    pages: [
      { pageNumber: 1, text: text }
    ],
    metadata: {
      fileType: ext,
      fileSize: stats.size,
      pageCount: 1,
      wordCount: text.split(/\s+/).length
    }
  };
}
