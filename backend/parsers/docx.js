import mammoth from 'mammoth';

export async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value || '';
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  
  return {
    text: text,
    pages: [
      { pageNumber: 1, text: text }
    ],
    metadata: {
      pageCount: 1,
      wordCount,
      fileType: '.docx'
    }
  };
}
