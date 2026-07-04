import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import AdmZip from 'adm-zip';
import { getProjectRoot } from '../shared/config.js';

const PROJECT_ROOT = getProjectRoot();
const KNOWLEDGE_ROOT = path.join(PROJECT_ROOT, 'knowledge');

// Ensure knowledge directory exists
if (!fs.existsSync(KNOWLEDGE_ROOT)) {
  fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
}

export function getKnowledgeRoot() {
  return KNOWLEDGE_ROOT;
}

export function getWorkspacePath(name) {
  // Prevent path traversal
  const safeName = path.basename(name);
  return path.join(KNOWLEDGE_ROOT, safeName);
}

// ----------------------------------------------------
// WORKSPACE MANAGEMENT
// ----------------------------------------------------

export function listWorkspaces() {
  if (!fs.existsSync(KNOWLEDGE_ROOT)) return [];
  
  return fs.readdirSync(KNOWLEDGE_ROOT)
    .filter(file => {
      const fullPath = path.join(KNOWLEDGE_ROOT, file);
      return fs.statSync(fullPath).isDirectory();
    })
    .map(name => {
      const workspacePath = path.join(KNOWLEDGE_ROOT, name);
      let chatMeta = {};
      try {
        const yamlPath = path.join(workspacePath, 'chat.yaml');
        if (fs.existsSync(yamlPath)) {
          chatMeta = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
        }
      } catch (err) {
        console.error(`Error reading metadata for workspace ${name}:`, err);
      }
      
      return {
        name,
        created: chatMeta.created || fs.statSync(workspacePath).birthtime,
        model: chatMeta.model || null
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
}

export function createWorkspace(name) {
  const safeName = path.basename(name).trim();
  if (!safeName) throw new Error('Workspace name cannot be empty');
  
  const wsPath = getWorkspacePath(safeName);
  if (fs.existsSync(wsPath)) {
    throw new Error('Workspace already exists');
  }

  // Create workspace and subdirectories
  fs.mkdirSync(wsPath, { recursive: true });
  fs.mkdirSync(path.join(wsPath, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(wsPath, 'extracted'), { recursive: true });
  fs.mkdirSync(path.join(wsPath, 'metadata'), { recursive: true });
  fs.mkdirSync(path.join(wsPath, 'summaries'), { recursive: true });
  fs.mkdirSync(path.join(wsPath, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(wsPath, 'embeddings'), { recursive: true });

  // Create initial chat.md
  const chatMdContent = `# Chat: ${safeName}\n\n`;
  fs.writeFileSync(path.join(wsPath, 'chat.md'), chatMdContent, 'utf8');

  // Create initial chat.yaml
  const chatYamlContent = {
    name: safeName,
    created: new Date().toISOString(),
    provider: '',
    model: '',
    temperature: 0.7,
    systemPrompt: ''
  };
  fs.writeFileSync(path.join(wsPath, 'chat.yaml'), yaml.dump(chatYamlContent), 'utf8');

  // Create initial indexing.yaml
  const indexingContent = {
    files: {}
  };
  fs.writeFileSync(path.join(wsPath, 'indexing.yaml'), yaml.dump(indexingContent), 'utf8');

  return { name: safeName };
}

export function renameWorkspace(oldName, newName) {
  const safeOldName = path.basename(oldName);
  const safeNewName = path.basename(newName).trim();
  if (!safeNewName) throw new Error('New name cannot be empty');

  const oldPath = getWorkspacePath(safeOldName);
  const newPath = getWorkspacePath(safeNewName);

  if (!fs.existsSync(oldPath)) {
    throw new Error('Workspace does not exist');
  }
  if (fs.existsSync(newPath)) {
    throw new Error('Target workspace name already exists');
  }

  fs.renameSync(oldPath, newPath);

  // Update name inside chat.yaml
  const yamlPath = path.join(newPath, 'chat.yaml');
  if (fs.existsSync(yamlPath)) {
    try {
      const chatMeta = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
      chatMeta.name = safeNewName;
      fs.writeFileSync(yamlPath, yaml.dump(chatMeta), 'utf8');
    } catch (e) {
      console.error('Error updating workspace name in chat.yaml:', e);
    }
  }

  return { name: safeNewName };
}

export function deleteWorkspace(name) {
  const safeName = path.basename(name);
  const wsPath = getWorkspacePath(safeName);

  if (!fs.existsSync(wsPath)) {
    throw new Error('Workspace does not exist');
  }

  fs.rmSync(wsPath, { recursive: true, force: true });
  return { success: true };
}

// ----------------------------------------------------
// CHAT & LOGS MANAGEMENT
// ----------------------------------------------------

export function getChatData(workspaceName) {
  const wsPath = getWorkspacePath(workspaceName);
  if (!fs.existsSync(wsPath)) {
    throw new Error('Workspace does not exist');
  }

  const mdPath = path.join(wsPath, 'chat.md');
  const yamlPath = path.join(wsPath, 'chat.yaml');

  const mdContent = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
  const yamlContent = fs.existsSync(yamlPath) ? yaml.load(fs.readFileSync(yamlPath, 'utf8')) : {};

  // Parse chat.md to get structured messages
  const messages = parseChatMd(mdContent);

  return {
    markdown: mdContent,
    settings: yamlContent,
    messages
  };
}

export function saveChatSettings(workspaceName, settings) {
  const wsPath = getWorkspacePath(workspaceName);
  const yamlPath = path.join(wsPath, 'chat.yaml');
  
  let currentSettings = {};
  if (fs.existsSync(yamlPath)) {
    currentSettings = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || {};
  }

  const updatedSettings = { ...currentSettings, ...settings };
  fs.writeFileSync(yamlPath, yaml.dump(updatedSettings), 'utf8');
  return updatedSettings;
}

export function appendChatMessage(workspaceName, sender, text) {
  const wsPath = getWorkspacePath(workspaceName);
  const mdPath = path.join(wsPath, 'chat.md');

  // Format message as Markdown
  const timestamp = new Date().toISOString();
  const formattedMessage = `### ${sender} (${timestamp})\n\n${text}\n\n---\n\n`;

  fs.appendFileSync(mdPath, formattedMessage, 'utf8');

  // Return the parsed list of messages
  const updatedMd = fs.readFileSync(mdPath, 'utf8');
  return parseChatMd(updatedMd);
}

export function overwriteChatMd(workspaceName, messages) {
  const wsPath = getWorkspacePath(workspaceName);
  const mdPath = path.join(wsPath, 'chat.md');

  let content = `# Chat: ${workspaceName}\n\n`;
  for (const msg of messages) {
    content += `### ${msg.sender} (${msg.timestamp})\n\n${msg.text}\n\n---\n\n`;
  }
  
  fs.writeFileSync(mdPath, content, 'utf8');
  return parseChatMd(content);
}

function parseChatMd(mdContent) {
  const messages = [];
  // Match standard headers: ### User (2026-07-04T12:00:00.000Z) or ### Assistant (...)
  const messageRegex = /### (User|Assistant) \(([^)]+)\)\s+([\s\S]*?)(?=\n\n---\n\n|$)/g;
  
  let match;
  while ((match = messageRegex.exec(mdContent)) !== null) {
    const sender = match[1];
    const timestamp = match[2];
    const text = match[3].trim();
    
    messages.push({
      sender,
      timestamp,
      text
    });
  }
  
  return messages;
}

// ----------------------------------------------------
// INDEXING & FILE MANAGMENT
// ----------------------------------------------------

export function getIndexingStatus(workspaceName) {
  const wsPath = getWorkspacePath(workspaceName);
  const yamlPath = path.join(wsPath, 'indexing.yaml');

  if (!fs.existsSync(yamlPath)) {
    return { files: {} };
  }

  return yaml.load(fs.readFileSync(yamlPath, 'utf8')) || { files: {} };
}

export function updateFileIndexingStatus(workspaceName, filename, statusInfo) {
  const wsPath = getWorkspacePath(workspaceName);
  const yamlPath = path.join(wsPath, 'indexing.yaml');

  let indexing = { files: {} };
  if (fs.existsSync(yamlPath)) {
    indexing = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || { files: {} };
  }

  indexing.files = indexing.files || {};
  indexing.files[filename] = {
    ...(indexing.files[filename] || {}),
    ...statusInfo,
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(yamlPath, yaml.dump(indexing), 'utf8');
  return indexing;
}

export function getWorkspaceAssets(workspaceName) {
  const wsPath = getWorkspacePath(workspaceName);
  const assetsPath = path.join(wsPath, 'assets');
  if (!fs.existsSync(assetsPath)) return [];

  const files = fs.readdirSync(assetsPath);
  const indexing = getIndexingStatus(workspaceName);

  return files.map(filename => {
    const filePath = path.join(assetsPath, filename);
    const stats = fs.statSync(filePath);
    const status = indexing.files[filename] || { status: 'queued', addedAt: stats.birthtime.toISOString() };

    return {
      filename,
      size: stats.size,
      birthtime: stats.birthtime,
      status: status.status,
      error: status.error || null,
      processedAt: status.processedAt || null
    };
  });
}

// ----------------------------------------------------
// ZIP EXPORT & IMPORT
// ----------------------------------------------------

export function exportWorkspaceZip(workspaceName) {
  const wsPath = getWorkspacePath(workspaceName);
  if (!fs.existsSync(wsPath)) {
    throw new Error('Workspace does not exist');
  }

  const zip = new AdmZip();
  zip.addLocalFolder(wsPath);
  return zip.toBuffer();
}

export function importWorkspaceZip(zipBuffer, originalFileName) {
  let wsName = path.basename(originalFileName, '.zip');
  wsName = wsName.replace(/\s+/g, '_'); // normalize name
  
  // Resolve unique name
  let targetPath = getWorkspacePath(wsName);
  let counter = 1;
  const baseWsName = wsName;
  while (fs.existsSync(targetPath)) {
    wsName = `${baseWsName}_${counter}`;
    targetPath = getWorkspacePath(wsName);
    counter++;
  }

  fs.mkdirSync(targetPath, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(targetPath, true);

  // Validate workspace structure
  const subDirs = ['assets', 'extracted', 'metadata', 'summaries', 'cache', 'embeddings'];
  for (const dir of subDirs) {
    const dirPath = path.join(targetPath, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // Ensure chat.md and chat.yaml exist
  const chatMd = path.join(targetPath, 'chat.md');
  if (!fs.existsSync(chatMd)) {
    fs.writeFileSync(chatMd, `# Chat: ${wsName}\n\n`, 'utf8');
  }

  const chatYaml = path.join(targetPath, 'chat.yaml');
  if (!fs.existsSync(chatYaml)) {
    fs.writeFileSync(chatYaml, yaml.dump({
      name: wsName,
      created: new Date().toISOString(),
      model: ''
    }), 'utf8');
  } else {
    // Override name in chat.yaml with current extracted folder name
    try {
      const meta = yaml.load(fs.readFileSync(chatYaml, 'utf8')) || {};
      meta.name = wsName;
      fs.writeFileSync(chatYaml, yaml.dump(meta), 'utf8');
    } catch (e) {
      console.error(e);
    }
  }

  const indexingYaml = path.join(targetPath, 'indexing.yaml');
  if (!fs.existsSync(indexingYaml)) {
    fs.writeFileSync(indexingYaml, yaml.dump({ files: {} }), 'utf8');
  }

  return { name: wsName };
}

export function deleteFile(workspaceName, filename) {
  const wsPath = getWorkspacePath(workspaceName);
  
  const filesToDelete = [
    path.join(wsPath, 'assets', filename),
    path.join(wsPath, 'summaries', `${filename}.md`),
    path.join(wsPath, 'extracted', `${filename}.md`),
    path.join(wsPath, 'metadata', `${filename}.yaml`)
  ];

  for (const filePath of filesToDelete) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Update indexing.yaml
  const yamlPath = path.join(wsPath, 'indexing.yaml');
  if (fs.existsSync(yamlPath)) {
    let indexing = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || { files: {} };
    if (indexing.files && indexing.files[filename]) {
      delete indexing.files[filename];
      fs.writeFileSync(yamlPath, yaml.dump(indexing), 'utf8');
    }
  }

  return { success: true };
}

export function renameFile(workspaceName, oldFilename, newFilename) {
  const wsPath = getWorkspacePath(workspaceName);
  
  const oldAssetPath = path.join(wsPath, 'assets', oldFilename);
  const newAssetPath = path.join(wsPath, 'assets', newFilename);
  
  if (fs.existsSync(newAssetPath)) {
    throw new Error('A file with the new name already exists');
  }

  // Rename asset file
  if (fs.existsSync(oldAssetPath)) {
    fs.renameSync(oldAssetPath, newAssetPath);
  }

  // Rename summary file
  const oldSummaryPath = path.join(wsPath, 'summaries', `${oldFilename}.md`);
  const newSummaryPath = path.join(wsPath, 'summaries', `${newFilename}.md`);
  if (fs.existsSync(oldSummaryPath)) {
    fs.renameSync(oldSummaryPath, newSummaryPath);
  }

  // Rename extracted file
  const oldExtractedPath = path.join(wsPath, 'extracted', `${oldFilename}.md`);
  const newExtractedPath = path.join(wsPath, 'extracted', `${newFilename}.md`);
  if (fs.existsSync(oldExtractedPath)) {
    fs.renameSync(oldExtractedPath, newExtractedPath);
  }

  // Rename metadata file
  const oldMetadataPath = path.join(wsPath, 'metadata', `${oldFilename}.yaml`);
  const newMetadataPath = path.join(wsPath, 'metadata', `${newFilename}.yaml`);
  if (fs.existsSync(oldMetadataPath)) {
    fs.renameSync(oldMetadataPath, newMetadataPath);

    // Update internal references in the new metadata YAML
    try {
      const meta = yaml.load(fs.readFileSync(newMetadataPath, 'utf8')) || {};
      if (meta.sourcePath === `assets/${oldFilename}`) {
        meta.sourcePath = `assets/${newFilename}`;
      }
      if (meta.title === oldFilename) {
        meta.title = newFilename;
      }
      fs.writeFileSync(newMetadataPath, yaml.dump(meta), 'utf8');
    } catch (e) {
      console.error('Error updating metadata on file rename:', e);
    }
  }

  // Update indexing.yaml
  const yamlPath = path.join(wsPath, 'indexing.yaml');
  if (fs.existsSync(yamlPath)) {
    let indexing = yaml.load(fs.readFileSync(yamlPath, 'utf8')) || { files: {} };
    if (indexing.files && indexing.files[oldFilename]) {
      indexing.files[newFilename] = indexing.files[oldFilename];
      delete indexing.files[oldFilename];
      fs.writeFileSync(yamlPath, yaml.dump(indexing), 'utf8');
    }
  }

  return { success: true };
}
