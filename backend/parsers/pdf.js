import fs from 'fs';
import pdf from 'pdf-parse';

export async function parsePdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  
  const pagesText = [];
  
  // This function is called by pdf-parse for each page
  function render_page(pageData) {
    return pageData.getTextContent()
      .then(function(textContent) {
        let lastY, text = '';
        for (let item of textContent.items) {
          if (lastY === item.transform[5] || !lastY) {
            text += item.str;
          } else {
            text += '\n' + item.str;
          }
          lastY = item.transform[5];
        }
        
        pagesText.push({
          pageNumber: pageData.pageIndex + 1,
          text: text
        });
        
        return text;
      });
  }

  const options = {
    pagerender: render_page
  };

  const data = await pdf(dataBuffer, options);
  
  // Sort pages by page number
  let finalPages = pagesText.sort((a, b) => a.pageNumber - b.pageNumber);
  
  // Fallback: if render_page didn't populate properly, split by formfeed
  if (finalPages.length === 0) {
    const rawText = data.text || '';
    const rawPages = rawText.split(/\u000C/);
    finalPages = rawPages.map((pageText, index) => ({
      pageNumber: index + 1,
      text: pageText.trim()
    })).filter(p => p.text.length > 0);
  }

  // Ensure we have at least one page if text exists
  if (finalPages.length === 0 && (data.text || '').trim()) {
    finalPages = [{ pageNumber: 1, text: data.text.trim() }];
  }

  const wordCount = (data.text || '').trim().split(/\s+/).filter(Boolean).length;

  return {
    text: data.text || '',
    pages: finalPages,
    metadata: {
      author: data.info?.Author || 'Unknown',
      title: data.info?.Title || 'Unknown',
      pageCount: data.numpages || finalPages.length || 1,
      wordCount,
      creationDate: data.info?.CreationDate || null,
      creator: data.info?.Creator || null,
      fileType: '.pdf'
    }
  };
}
