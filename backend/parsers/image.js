import { createWorker } from 'tesseract.js';
import sharp from 'sharp';

export async function parseImage(filePath) {
  let imageMeta = {};
  
  // Use sharp to read image properties
  try {
    const meta = await sharp(filePath).metadata();
    imageMeta = {
      fileType: '.' + (meta.format || 'image'),
      width: meta.width,
      height: meta.height,
      space: meta.space,
      density: meta.density,
      channels: meta.channels
    };
  } catch (err) {
    console.error('Sharp error reading image metadata:', err);
    imageMeta = { fileType: 'image' };
  }

  let text = '';
  let worker = null;
  
  try {
    // Tesseract.js v5 createWorker supports passing language directly
    worker = await createWorker('eng');
    const { data } = await worker.recognize(filePath);
    text = data.text || '';
  } catch (err) {
    console.error('Tesseract OCR error:', err);
    text = `[OCR Error: Could not extract text from image. Details: ${err.message}]`;
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  
  return {
    text: text,
    pages: [
      { pageNumber: 1, text: text }
    ],
    metadata: {
      ...imageMeta,
      pageCount: 1,
      wordCount
    }
  };
}
