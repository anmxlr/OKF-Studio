import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getWorkspacePath } from '../filesystem/manager.js';
import { chatCompletion } from '../llm/client.js';

/**
 * Searches the workspace using the multi-stage strategy:
 * 1. Read all files in summaries/ to select candidate files.
 * 2. Read metadata YAML and extracted markdown for those candidate files.
 * 3. Extract relevant sections.
 * 4. Generate final answer using retrieved sections.
 */
export async function searchWorkspace(workspaceName, userQuery) {
  const wsPath = getWorkspacePath(workspaceName);
  
  const summariesPath = path.join(wsPath, 'summaries');
  const metadataPath = path.join(wsPath, 'metadata');
  const extractedPath = path.join(wsPath, 'extracted');
  const assetsPath = path.join(wsPath, 'assets');

  // Verify paths exist
  if (!fs.existsSync(summariesPath)) {
    return {
      answer: "No indexed documents found in this workspace. Please upload some files first.",
      sources: []
    };
  }

  // 1. Gather all file summaries
  const summaryFiles = fs.readdirSync(summariesPath).filter(f => f.endsWith('.md'));
  if (summaryFiles.length === 0) {
    return {
      answer: "No document summaries found. Please wait for indexing to complete or upload documents.",
      sources: []
    };
  }

  const summariesList = [];
  for (const file of summaryFiles) {
    const originalName = file.replace(/\.md$/, ''); // Strip .md extension to get original asset filename
    const content = fs.readFileSync(path.join(summariesPath, file), 'utf8');
    summariesList.push({
      filename: originalName,
      summary: content
    });
  }

  // 2. Query LLM to identify the most relevant files based on summaries
  let candidateFiles = [];
  try {
    const selectionPrompt = `You are a search router. Your job is to select which files are highly relevant to answer the query from the list of summaries.
    
Query: "${userQuery}"

Available Files & Summaries:
${summariesList.map(s => `- File: "${s.filename}"\n  Summary: ${s.summary}`).join('\n\n')}

Identify the files that might contain the answer. Return a JSON array of strings containing ONLY the filenames.
Example output: ["report.pdf", "data.csv"]
If no files are relevant, return: []`;

    const selectionResponse = await chatCompletion([
      { role: 'user', content: selectionPrompt }
    ], { temperature: 0.1 });

    // Parse JSON response
    const jsonMatch = selectionResponse.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      candidateFiles = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback: simple text match on filename
      candidateFiles = summariesList
        .filter(s => userQuery.toLowerCase().includes(s.filename.toLowerCase()))
        .map(s => s.filename);
    }
  } catch (err) {
    console.error('Error selecting candidates via LLM:', err);
    // Default fallback: select all files if there are few, or the first 3
    candidateFiles = summariesList.slice(0, 3).map(s => s.filename);
  }

  // Filter valid candidate files that actually exist
  candidateFiles = candidateFiles.filter(filename => 
    fs.existsSync(path.join(extractedPath, `${filename}.md`))
  );

  // If no candidates identified, default to first 3 files
  if (candidateFiles.length === 0 && summariesList.length > 0) {
    candidateFiles = summariesList.slice(0, 3).map(s => s.filename);
  }

  // 3. Read metadata and extracted markdown of candidates to pull specific sections
  const retrievedSections = [];
  const sourcesMeta = [];

  for (const filename of candidateFiles) {
    try {
      const extMdContent = fs.readFileSync(path.join(extractedPath, `${filename}.md`), 'utf8');
      const metaContent = yaml.load(fs.readFileSync(path.join(metadataPath, `${filename}.yaml`), 'utf8')) || {};

      sourcesMeta.push({
        filename,
        author: metaContent.author || 'Unknown',
        topics: metaContent.topics || [],
        tags: metaContent.tags || [],
        processingDate: metaContent.processingDate
      });

      // Query LLM to extract only the matching text chunks or details from the extracted profile
      const extractionPrompt = `You are a precise context retriever. Extract the specific sections, text passages, lists, or tables from the Document Profile that are relevant to answer the query.

Query: "${userQuery}"

Document Profile:
${extMdContent}

Extract ONLY the paragraphs, headers, and values that directly pertain to the query. If a section is relevant, quote it. Specify page numbers if they are mentioned. Do not make up any information.`;

      const chunkResponse = await chatCompletion([
        { role: 'user', content: extractionPrompt }
      ], { temperature: 0.1 });

      retrievedSections.push(`--- Context Source: ${filename} ---\n${chunkResponse}`);
    } catch (err) {
      console.error(`Error reading context for candidate ${filename}:`, err);
    }
  }

  // 4. Formulate the final answer using retrieved sections as context
  const contextText = retrievedSections.join('\n\n');
  return {
    context: contextText,
    sources: sourcesMeta
  };
}
