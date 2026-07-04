import AdmZip from 'adm-zip';
import path from 'path';

export async function parsePptx(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text = '';
  const pages = [];
  let slideCount = 0;

  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    // PowerPoint slide files are stored in ppt/slides/slide{N}.xml
    const slideEntries = zipEntries.filter(entry => 
      entry.entryName.startsWith('ppt/slides/slide') && entry.entryName.endsWith('.xml')
    );

    // Sort slides numerically (e.g. slide1.xml, slide2.xml, slide10.xml)
    slideEntries.sort((a, b) => {
      const aNum = parseInt(a.entryName.match(/\d+/)?.[0] || '0', 10);
      const bNum = parseInt(b.entryName.match(/\d+/)?.[0] || '0', 10);
      return aNum - bNum;
    });

    slideCount = slideEntries.length;

    slideEntries.forEach((entry, idx) => {
      const xml = entry.getData().toString('utf8');
      
      // Match text tags: <a:t>text content</a:t>
      const textMatches = xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [];
      const slideText = textMatches.map(match => {
        // Strip XML tags and decode HTML entities
        return match.replace(/<a:t>|<\/a:t>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
      }).join(' ');

      const cleanSlideText = slideText.trim();
      pages.push({
        pageNumber: idx + 1,
        text: cleanSlideText
      });
    });

    text = pages.map(p => `### Slide ${p.pageNumber}\n\n${p.text}`).join('\n\n');

  } catch (err) {
    console.error('Error parsing PPTX slide zip content:', err);
    text = `[Error parsing PPTX: ${err.message}]`;
    pages.push({ pageNumber: 1, text });
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  return {
    text: text,
    pages: pages.length > 0 ? pages : [{ pageNumber: 1, text }],
    metadata: {
      fileType: ext,
      pageCount: slideCount || 1,
      wordCount
    }
  };
}
