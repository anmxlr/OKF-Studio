import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function parseMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stats = fs.statSync(filePath);
  const basename = path.basename(filePath, ext);
  
  // Resolve workspace directory (filePath is in assets/ folder, so go up 2 levels)
  const workspacePath = path.resolve(filePath, '../..');
  const cachePath = path.join(workspacePath, 'cache');
  
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true });
  }

  console.log(`[parseMedia] Initiating local Whisper transcription for: ${filePath}`);
  
  let transcript = '';
  try {
    // Run Whisper command line locally
    // --model base provides a good balance between speed and accuracy
    const cmd = `whisper "${filePath}" --output_dir "${cachePath}" --output_format txt --model base`;
    await execPromise(cmd);
    
    // Read the output transcription file
    const txtPath = path.join(cachePath, `${basename}.txt`);
    if (fs.existsSync(txtPath)) {
      transcript = fs.readFileSync(txtPath, 'utf8').trim();
      // Clean up the temporary txt output file
      fs.unlinkSync(txtPath);
    }
  } catch (err) {
    console.error(`[parseMedia] Whisper transcription failed:`, err);
    transcript = `[Transcription failed or timed out: ${err.message}]`;
  }

  const text = `Media File: ${path.basename(filePath)}
Type: ${ext}
Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB
Created: ${stats.birthtime.toISOString()}

--- Transcription Start ---
${transcript || 'No speech detected or empty audio file.'}
--- Transcription End ---`;

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
