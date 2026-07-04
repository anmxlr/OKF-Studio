import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';

import apiRouter from './api/routes.js';
import { listWorkspaces } from './filesystem/manager.js';
import { resumePendingTasks } from './agents/indexer.js';
import { loadConfig } from './shared/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and parsing middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend assets
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

async function downloadVendorFiles() {
  const vendorDir = path.join(frontendPath, 'vendor');
  if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true });
  }

  const files = [
    {
      name: 'marked.min.js',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js'
    },
    {
      name: 'prism.js',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js'
    },
    {
      name: 'prism.css',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css'
    }
  ];

  for (const file of files) {
    const filePath = path.join(vendorDir, file.name);
    if (!fs.existsSync(filePath)) {
      console.log(`Downloading vendor asset: ${file.name}...`);
      try {
        const res = await fetch(file.url);
        if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
        const content = await res.text();
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Downloaded ${file.name} successfully.`);
      } catch (err) {
        console.error(`Failed to download vendor asset ${file.name}:`, err);
        // Write simple fallback definitions to keep app runnable
        if (file.name === 'marked.min.js') {
          fs.writeFileSync(filePath, 'window.marked = { parse: (x) => x };', 'utf8');
        } else if (file.name === 'prism.js') {
          fs.writeFileSync(filePath, 'window.Prism = { highlightAll: () => {} };', 'utf8');
        } else if (file.name === 'prism.css') {
          fs.writeFileSync(filePath, '/* Fallback css */', 'utf8');
        }
      }
    }
  }
}

// API router
app.use('/api', apiRouter);

// Fallback to index.html for single page application routing
app.get('*', (req, res, next) => {
  // If it's a call to an API endpoint that wasn't matched, skip
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Boot the server
app.listen(PORT, async () => {
  console.log('----------------------------------------------------');
  console.log(`Open Knowledge Format (OKF) Server Running!`);
  console.log(`URL: http://localhost:${PORT}`);
  console.log('----------------------------------------------------');
  
  // Download static libraries if offline assets are missing
  await downloadVendorFiles();
  
  // Load config (creates config.yaml if missing)
  const config = loadConfig();
  console.log(`Active Provider: ${config.provider}`);
  console.log(`Active Model: ${config.model}`);
  console.log(`Ollama Endpoint: ${config.ollamaEndpoint}`);
  console.log(`LM Studio Endpoint: ${config.lmStudioEndpoint}`);
  console.log('----------------------------------------------------');

  // Resume any unfinished indexing tasks from last session
  try {
    const workspaces = listWorkspaces();
    resumePendingTasks(workspaces);
  } catch (err) {
    console.error('Failed to resume indexing queue:', err);
  }
});
