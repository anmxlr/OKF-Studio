import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import yaml from 'js-yaml';

import { 
  listWorkspaces, 
  createWorkspace, 
  renameWorkspace, 
  deleteWorkspace, 
  getChatData, 
  saveChatSettings, 
  appendChatMessage,
  overwriteChatMd,
  getWorkspaceAssets,
  getIndexingStatus,
  updateFileIndexingStatus,
  exportWorkspaceZip,
  importWorkspaceZip,
  getWorkspacePath,
  deleteFile,
  renameFile
} from '../filesystem/manager.js';

import { loadConfig, saveConfig } from '../shared/config.js';
import { getModels, chatCompletion } from '../llm/client.js';
import { enqueueFile, reindexFile } from '../agents/indexer.js';
import { searchWorkspace } from '../agents/searcher.js';

const router = express.Router();

// Multer setup for handling file uploads directly into workspace assets
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const wsName = req.params.name;
    const wsPath = getWorkspacePath(wsName);
    const dest = path.join(wsPath, 'assets');
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Multer setup for zip imports
const zipStorage = multer.memoryStorage();
const uploadZip = multer({ storage: zipStorage });

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------
router.get('/settings', (req, res) => {
  try {
    const config = loadConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ success: true, config: loadConfig() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/models', async (req, res) => {
  try {
    const models = await getModels();
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// WORKSPACES
// ----------------------------------------------------
router.get('/workspaces', (req, res) => {
  try {
    res.json(listWorkspaces());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces', (req, res) => {
  try {
    const { name } = req.body;
    const result = createWorkspace(name);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/workspaces/:name/rename', (req, res) => {
  try {
    const { newName } = req.body;
    const result = renameWorkspace(req.params.name, newName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/workspaces/:name', (req, res) => {
  try {
    const result = deleteWorkspace(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// CHAT
// ----------------------------------------------------
router.get('/workspaces/:name/chat', (req, res) => {
  try {
    res.json(getChatData(req.params.name));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/workspaces/:name/chat/settings', (req, res) => {
  try {
    const updated = saveChatSettings(req.params.name, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:name/chat/clear', (req, res) => {
  try {
    const result = overwriteChatMd(req.params.name, []);
    res.json({ success: true, messages: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Handle chat completion with SSE streaming
 */
router.post('/workspaces/:name/chat', async (req, res) => {
  const wsName = req.params.name;
  const { message, model, provider, temperature } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  // 1. Save the user's message to chat.md
  let chatHistory;
  try {
    chatHistory = appendChatMessage(wsName, 'User', message);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Setup Server-Sent Events headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 2. Perform multi-stage workspace search to gather context
  let searchContext = '';
  let sourcesList = [];
  try {
    res.write(`data: ${JSON.stringify({ status: 'searching' })}\n\n`);
    const searchRes = await searchWorkspace(wsName, message);
    searchContext = searchRes.context || '';
    sourcesList = searchRes.sources || [];
    if (sourcesList.length > 0) {
      res.write(`data: ${JSON.stringify({ status: 'found_context', sources: sourcesList })}\n\n`);
    }
  } catch (err) {
    console.error('Workspace search failed:', err);
  }

  // 3. Compile prompt from template
  const config = loadConfig();
  const template = config.promptTemplate;
  const systemPrompt = template
    .replace('{{context}}', searchContext || 'No document context available.')
    .replace('{{question}}', message);

  // Build the message history to pass to LLM (excluding timestamps)
  const llmMessages = chatHistory.map(msg => ({
    role: msg.sender === 'User' ? 'user' : 'assistant',
    content: msg.text
  }));

  // Send the request to LLM and stream the response chunk-by-chunk
  let fullAssistantText = '';
  try {
    res.write(`data: ${JSON.stringify({ status: 'generating' })}\n\n`);
    
    fullAssistantText = await chatCompletion(llmMessages, {
      model,
      provider,
      temperature,
      systemPrompt
    }, (chunk) => {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    });

    // 4. Save the completed assistant response to chat.md
    appendChatMessage(wsName, 'Assistant', fullAssistantText);

    // Report success
    res.write(`data: ${JSON.stringify({ status: 'finished', text: fullAssistantText })}\n\n`);
  } catch (err) {
    console.error('LLM Streaming failed:', err);
    res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// ----------------------------------------------------
// UPLOADS & INDEXING
// ----------------------------------------------------
router.get('/workspaces/:name/assets', (req, res) => {
  try {
    res.json(getWorkspaceAssets(req.params.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:name/upload', upload.array('files'), (req, res) => {
  try {
    const wsName = req.params.name;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Queue each uploaded file for background indexing
    files.forEach(file => {
      enqueueFile(wsName, file.originalname);
    });

    res.json({
      success: true,
      message: `${files.length} files uploaded and added to the indexing queue.`,
      files: files.map(f => f.originalname)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workspaces/:name/index/status', (req, res) => {
  try {
    res.json(getIndexingStatus(req.params.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/:name/index/reindex', (req, res) => {
  try {
    const wsName = req.params.name;
    const { filename } = req.body;

    if (filename) {
      reindexFile(wsName, filename);
      res.json({ success: true, message: `Re-indexing queued for ${filename}` });
    } else {
      const assets = getWorkspaceAssets(wsName);
      assets.forEach(asset => reindexFile(wsName, asset.filename));
      res.json({ success: true, message: `Re-indexing queued for all workspace files.` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// IMPORT & EXPORT
// ----------------------------------------------------
router.get('/workspaces/:name/export', (req, res) => {
  try {
    const wsName = req.params.name;
    const zipBuffer = exportWorkspaceZip(wsName);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${wsName}.zip`);
    res.send(zipBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/workspaces/import', uploadZip.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const result = importWorkspaceZip(req.file.buffer, req.file.originalname);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// FILE PREVIEW / CONTENT ENDPOINTS
// ----------------------------------------------------
router.get('/workspaces/:name/files/:filename', (req, res) => {
  const wsPath = getWorkspacePath(req.params.name);
  const filePath = path.join(wsPath, 'assets', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

router.get('/workspaces/:name/extracted/:filename', (req, res) => {
  const wsPath = getWorkspacePath(req.params.name);
  const filePath = path.join(wsPath, 'extracted', `${req.params.filename}.md`);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Extracted text not found' });
  }
});

router.get('/workspaces/:name/metadata/:filename', (req, res) => {
  const wsPath = getWorkspacePath(req.params.name);
  const filePath = path.join(wsPath, 'metadata', `${req.params.filename}.yaml`);
  
  if (fs.existsSync(filePath)) {
    try {
      const content = yaml.load(fs.readFileSync(filePath, 'utf8'));
      res.json(content);
    } catch (e) {
      res.status(500).json({ error: 'Failed to read YAML: ' + e.message });
    }
  } else {
    res.status(404).json({ error: 'Metadata not found' });
  }
});

router.get('/workspaces/:name/summaries/:filename', (req, res) => {
  const wsPath = getWorkspacePath(req.params.name);
  const filePath = path.join(wsPath, 'summaries', `${req.params.filename}.md`);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Summary not found' });
  }
});

router.delete('/workspaces/:name/files/:filename', (req, res) => {
  try {
    const result = deleteFile(req.params.name, req.params.filename);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/workspaces/:name/files/:filename/rename', (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) {
      return res.status(400).json({ error: 'New filename is required' });
    }
    const result = renameFile(req.params.name, req.params.filename, newName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
