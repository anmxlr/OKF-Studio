import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { chatCompletion } from '../llm/client.js';

/**
 * Knowledge extraction pipeline: takes parsed text, queries the LLM to build summaries, structured md, and yaml.
 */
export async function extractKnowledge(workspacePath, filename, parsedDoc) {
  const assetPath = path.join(workspacePath, 'assets', filename);
  
  // 1. Calculate checksum of the original asset file
  let checksum = '';
  try {
    checksum = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex');
  } catch (err) {
    console.error('Error computing checksum:', err);
    checksum = 'unknown';
  }

  const now = new Date().toISOString();
  const textContent = parsedDoc.text || '';
  const wordCount = parsedDoc.metadata?.wordCount || textContent.split(/\s+/).filter(Boolean).length;
  const pageCount = parsedDoc.metadata?.pageCount || 1;
  const ext = path.extname(filename).toLowerCase();

  // Truncate input text snippet if it exceeds context limit for the local LLM
  let textSnippet = textContent;
  const maxWords = 3000;
  if (wordCount > maxWords) {
    const words = textContent.split(/\s+/);
    textSnippet = words.slice(0, maxWords).join(' ') + '\n\n... [TRUNCATED DUE TO SIZE LIMIT] ...';
  }

  // 1. Extract markdown summary, topics, findings, quotes, etc.
  const markdownPrompt = `You are a senior AI research scientist. Extract key knowledge from the document below and present it in a detailed, structured Markdown file.

Document: ${filename}
Word Count: ${wordCount}
Page Count: ${pageCount}

Content Snippet:
${textSnippet}

Structure the Markdown output exactly as follows:
# Knowledge Profile: ${filename}

## Summary
(Provide a comprehensive 2-3 paragraph summary of the document)

## Key Topics & Keywords
(Bullet points listing topics and tags)

## Important Facts & Findings
(A list of critical details, statistics, or facts found)

## Named Entities
- **People**: (names)
- **Organizations**: (organizations)
- **Locations**: (locations)

## Document Outline & Headings
(Reconstruct headings or high-level slide/sheet structure)

## Essential Quotes
(Quotes, if any)

## Data & Tables
(Markdown tables for any quantitative data found, or say "None")
`;

  let extractedMarkdown = '';
  try {
    extractedMarkdown = await chatCompletion([
      { role: 'user', content: markdownPrompt }
    ], { temperature: 0.2 });
  } catch (err) {
    console.error('Failed to generate extracted markdown, using raw content:', err);
    extractedMarkdown = `# Knowledge Profile: ${filename}\n\n[Parsing error: LLM could not process text. Here is raw text snippet]\n\n${textSnippet}`;
  }

  // 2. Extract structured YAML metadata
  const yamlPrompt = `You are an AI metadata generator. Extract properties from the document below and compile them into a VALID YAML block.

Document: ${filename}
Word Count: ${wordCount}
Page Count: ${pageCount}

Content Snippet:
${textSnippet}

Output ONLY a valid YAML block inside \`\`\`yaml and \`\`\` code fence. Follow this exact schema:
\`\`\`yaml
fileType: "${ext}"
language: "en"
topics:
  - (topic)
entities:
  - (entity)
dates:
  - (dates mentioned)
author: "Unknown"
pageCount: ${pageCount}
wordCount: ${wordCount}
tags:
  - (tag)
relationships:
  - (related files or concepts)
checksum: "${checksum}"
processingDate: "${now}"
sourcePath: "assets/${filename}"
\`\`\`
`;

  let extractedYamlText = '';
  let yamlObject = {};
  
  try {
    extractedYamlText = await chatCompletion([
      { role: 'user', content: yamlPrompt }
    ], { temperature: 0.1 });

    let cleanYaml = extractedYamlText;
    const yamlBlockRegex = /```yaml([\s\S]*?)```/;
    const match = extractedYamlText.match(yamlBlockRegex);
    if (match) {
      cleanYaml = match[1].trim();
    } else {
      const codeBlockRegex = /```([\s\S]*?)```/;
      const codeMatch = extractedYamlText.match(codeBlockRegex);
      if (codeMatch) {
        cleanYaml = codeMatch[1].trim();
      }
    }

    yamlObject = yaml.load(cleanYaml) || {};
  } catch (err) {
    console.error('YAML LLM generation failed, generating programmatically:', err);
  }

  // Standardize metadata keys to ensure completeness
  yamlObject = {
    fileType: yamlObject.fileType || ext,
    language: yamlObject.language || 'en',
    topics: yamlObject.topics || ['document'],
    entities: yamlObject.entities || [],
    dates: yamlObject.dates || [],
    author: yamlObject.author || 'Unknown',
    pageCount: Number(yamlObject.pageCount || pageCount),
    wordCount: Number(yamlObject.wordCount || wordCount),
    tags: yamlObject.tags || ['imported'],
    relationships: yamlObject.relationships || [],
    checksum,
    processingDate: now,
    sourcePath: `assets/${filename}`,
    ...yamlObject
  };

  // 3. Generate short executive summary
  const summaryPrompt = `Write a short 2-to-3 sentence executive summary of this document. Do not include introductory text, start directly with the summary.

Document: ${filename}
Snippet:
${textSnippet}
`;

  let shortSummary = '';
  try {
    shortSummary = await chatCompletion([
      { role: 'user', content: summaryPrompt }
    ], { temperature: 0.3 });
  } catch (err) {
    shortSummary = `Summary of ${filename} (Text word count: ${wordCount}).`;
  }

  // Write all representations to the workspace folders
  const summaryPath = path.join(workspacePath, 'summaries', `${filename}.md`);
  const extractedPath = path.join(workspacePath, 'extracted', `${filename}.md`);
  const metadataPath = path.join(workspacePath, 'metadata', `${filename}.yaml`);

  fs.writeFileSync(summaryPath, shortSummary, 'utf8');
  fs.writeFileSync(extractedPath, extractedMarkdown, 'utf8');
  fs.writeFileSync(metadataPath, yaml.dump(yamlObject), 'utf8');

  return { success: true };
}
