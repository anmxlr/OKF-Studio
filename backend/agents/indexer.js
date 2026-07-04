import path from 'path';
import { 
  getWorkspacePath, 
  updateFileIndexingStatus, 
  getIndexingStatus 
} from '../filesystem/manager.js';
import { parseFile } from '../parsers/manager.js';
import { extractKnowledge } from './extractor.js';

// In-memory queue of { workspaceName, filename }
const indexQueue = [];
let isProcessing = false;

/**
 * Enqueue a file for indexing.
 */
export function enqueueFile(workspaceName, filename) {
  // Update status on disk first
  updateFileIndexingStatus(workspaceName, filename, {
    status: 'queued',
    error: null,
    addedAt: new Date().toISOString()
  });

  // Add to in-memory queue if not already there
  const exists = indexQueue.some(item => 
    item.workspaceName === workspaceName && item.filename === filename
  );

  if (!exists) {
    indexQueue.push({ workspaceName, filename });
  }

  // Start processing loop if not running
  if (!isProcessing) {
    processNext();
  }
}

/**
 * Process the next file in the queue.
 */
async function processNext() {
  if (indexQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const { workspaceName, filename } = indexQueue.shift();

  try {
    console.log(`[Indexer] Starting processing: ${filename} in workspace ${workspaceName}`);
    
    // Update status to processing
    updateFileIndexingStatus(workspaceName, filename, { status: 'processing' });

    const wsPath = getWorkspacePath(workspaceName);
    const assetPath = path.join(wsPath, 'assets', filename);

    // 1. Run file text parser
    const parsedDoc = await parseFile(assetPath);

    // 2. Run LLM knowledge extractor (summaries, extracted md, metadata yaml)
    await extractKnowledge(wsPath, filename, parsedDoc);

    // Update status to finished
    updateFileIndexingStatus(workspaceName, filename, {
      status: 'finished',
      processedAt: new Date().toISOString()
    });
    console.log(`[Indexer] Successfully processed: ${filename}`);

  } catch (err) {
    console.error(`[Indexer] Failed to process ${filename}:`, err);
    updateFileIndexingStatus(workspaceName, filename, {
      status: 'failed',
      error: err.message
    });
  }

  // Process next item
  processNext();
}

/**
 * Check if the background worker is currently active.
 */
export function isWorkerActive() {
  return isProcessing;
}

/**
 * Trigger re-indexing for a specific file.
 */
export function reindexFile(workspaceName, filename) {
  enqueueFile(workspaceName, filename);
}

/**
 * Trigger re-indexing for all assets in a workspace.
 */
export function reindexAllFiles(workspaceName, filenames) {
  for (const file of filenames) {
    enqueueFile(workspaceName, file);
  }
}

/**
 * Startup hook to resume any files that were in "queued" or "processing" state
 * when the server last stopped.
 */
export function resumePendingTasks(workspaceList) {
  for (const ws of workspaceList) {
    try {
      const indexing = getIndexingStatus(ws.name);
      for (const [filename, info] of Object.entries(indexing.files || {})) {
        if (info.status === 'queued' || info.status === 'processing') {
          console.log(`[Indexer] Resuming interrupted task: ${filename} in workspace ${ws.name}`);
          enqueueFile(ws.name, filename);
        }
      }
    } catch (e) {
      console.error(`Error resuming tasks for workspace ${ws.name}:`, e);
    }
  }
}
