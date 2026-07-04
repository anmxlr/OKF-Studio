/* OKF Application Controller */

// Global State
let activeWorkspace = null;
let workspaces = [];
let activeFile = null;
let globalConfig = {};
let availableModels = [];
let indexingPollInterval = null;
let isGenerating = false;

// Voice Recording State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// DOM Elements
const workspaceList = document.getElementById('workspace-list');
const btnNewChat = document.getElementById('btn-new-chat');
const activeWorkspaceTitle = document.getElementById('active-workspace-title');
const workspaceActions = document.querySelector('.workspace-actions');
const btnRenameWs = document.getElementById('btn-rename-ws');
const btnDeleteWs = document.getElementById('btn-delete-ws');
const btnExportWs = document.getElementById('btn-export-ws');
const btnViewFiles = document.getElementById('btn-view-files');
const indexingIndicator = document.getElementById('indexing-indicator');
const indexingStatusText = document.getElementById('indexing-status-text');
const btnSettings = document.getElementById('btn-settings');

const chatMessages = document.getElementById('chat-messages');
const sourcesBadgeContainer = document.getElementById('sources-badge-container');
const sourcesBadges = document.getElementById('sources-badges');

const btnAttach = document.getElementById('btn-attach');
const fileUploader = document.getElementById('file-uploader');
const promptInput = document.getElementById('prompt-input');
const btnAudio = document.getElementById('btn-audio');
const btnSend = document.getElementById('btn-send');
const modelSelector = document.getElementById('model-selector');
const tokenUsage = document.getElementById('token-usage');

// Drawer Elements
const fileViewerDrawer = document.getElementById('file-viewer-drawer');
const btnCloseDrawer = document.getElementById('btn-close-drawer');
const drawerFileSelect = document.getElementById('drawer-file-select');
const btnReindexFile = document.getElementById('btn-reindex-file');
const btnRenameFile = document.getElementById('btn-rename-file');
const btnDeleteFile = document.getElementById('btn-delete-file');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Viewer Content
const summaryViewerContent = document.getElementById('summary-viewer-content');
const metadataViewerContent = document.getElementById('metadata-viewer-content');
const extractedViewerContent = document.getElementById('extracted-viewer-content');
const originalViewerContent = document.getElementById('original-viewer-content');

// Settings Elements
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const settingsForm = document.getElementById('settings-form');
const valTemp = document.getElementById('val-temp');
const tempSlider = document.getElementById('setting-temperature');

// Rename Elements
const renameModal = document.getElementById('rename-modal');
const btnCloseRename = document.getElementById('btn-close-rename');
const btnCancelRename = document.getElementById('btn-cancel-rename');
const btnSaveRename = document.getElementById('btn-save-rename');
const renameWsInput = document.getElementById('rename-ws-input');

// Create Elements
const createModal = document.getElementById('create-modal');
const btnCloseCreate = document.getElementById('btn-close-create');
const btnCancelCreate = document.getElementById('btn-cancel-create');
const btnSaveCreate = document.getElementById('btn-save-create');
const createWsInput = document.getElementById('create-ws-input');

// Import Elements
const importFile = document.getElementById('import-file');
const importZone = document.getElementById('import-zone');

// Initialize App
async function init() {
  await loadSettings();
  await fetchModels();
  await fetchWorkspaces();
  
  // Restore active workspace if refreshed inside the same session
  const lastActive = sessionStorage.getItem('lastActiveWorkspace');
  if (lastActive && workspaces.some(w => w.name === lastActive)) {
    await selectWorkspace(lastActive);
  }

  setupEventListeners();
  
  // Auto-resize input prompt
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = promptInput.scrollHeight + 'px';
  });
}

// ----------------------------------------------------
// EVENT LISTENERS
// ----------------------------------------------------
function setupEventListeners() {
  // Sidebar actions
  btnNewChat.addEventListener('click', () => {
    createWsInput.value = '';
    openModal(createModal);
    createWsInput.focus();
  });
  
  // Workspace management buttons
  btnRenameWs.addEventListener('click', () => {
    renameWsInput.value = activeWorkspace || '';
    openModal(renameModal);
    renameWsInput.focus();
  });
  btnDeleteWs.addEventListener('click', handleDeleteWorkspace);
  btnExportWs.addEventListener('click', handleExportWorkspace);
  btnViewFiles.addEventListener('click', handleToggleFilesDrawer);
  
  // Settings actions
  btnSettings.addEventListener('click', () => openModal(settingsModal));
  btnCloseSettings.addEventListener('click', () => closeModal(settingsModal));
  btnCancelSettings.addEventListener('click', () => closeModal(settingsModal));
  settingsForm.addEventListener('submit', handleSaveSettings);
  tempSlider.addEventListener('input', (e) => {
    valTemp.textContent = e.target.value;
  });

  // Rename actions
  btnCloseRename.addEventListener('click', () => closeModal(renameModal));
  btnCancelRename.addEventListener('click', () => closeModal(renameModal));
  btnSaveRename.addEventListener('click', handleRenameWorkspace);
  renameWsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameWorkspace();
    }
  });

  // Create actions
  btnCloseCreate.addEventListener('click', () => closeModal(createModal));
  btnCancelCreate.addEventListener('click', () => closeModal(createModal));
  btnSaveCreate.addEventListener('click', handleCreateWorkspace);
  createWsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreateWorkspace();
    }
  });

  // Import ZIP actions
  importFile.addEventListener('change', handleImportWorkspace);
  setupDragAndDrop(importZone, async (file) => {
    await uploadZipWorkspace(file);
  });

  // Chat actions
  btnSend.addEventListener('click', sendMessage);
  btnAudio.addEventListener('click', toggleAudioRecording);
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // File Upload actions
  btnAttach.addEventListener('click', () => fileUploader.click());
  fileUploader.addEventListener('change', handleUploadFiles);
  
  // Main chat drag-and-drop for attachments
  setupDragAndDrop(document.body, async (file) => {
    if (activeWorkspace) {
      await uploadFilesDirect([file]);
    } else {
      alert("Please select a workspace before uploading documents.");
    }
  }, true);

  // Drawer actions
  btnCloseDrawer.addEventListener('click', () => fileViewerDrawer.classList.add('hidden'));
  drawerFileSelect.addEventListener('change', (e) => selectFileForViewer(e.target.value));
  btnReindexFile.addEventListener('click', handleReindexActiveFile);
  btnRenameFile.addEventListener('click', handleRenameActiveFile);
  btnDeleteFile.addEventListener('click', handleDeleteActiveFile);

  // Drawer Tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const panelId = btn.getAttribute('data-tab');
      document.getElementById(panelId).classList.add('active');
    });
  });

  // Theme Switch Toggle
  const themeSwitch = document.getElementById('theme-switch');
  if (themeSwitch) {
    themeSwitch.addEventListener('change', async (e) => {
      const newTheme = e.target.checked ? 'dark' : 'light';
      document.body.className = newTheme === 'dark' ? 'theme-dark' : 'theme-light';
      globalConfig.theme = newTheme;
      
      // Sync settings modal theme select
      const selectTheme = document.getElementById('setting-theme');
      if (selectTheme) selectTheme.value = newTheme;

      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(globalConfig)
        });
      } catch (err) {
        console.error('Failed to save theme toggle setting:', err);
      }
    });
  }
}

// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------
function openModal(modal) {
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  modal.classList.add('hidden');
}

function setupDragAndDrop(element, callback, globalOverlay = false) {
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    element.classList.add('drag-active');
  });

  element.addEventListener('dragleave', () => {
    element.classList.remove('drag-active');
  });

  element.addEventListener('drop', (e) => {
    e.preventDefault();
    element.classList.remove('drag-active');
    if (e.dataTransfer.files.length > 0) {
      callback(e.dataTransfer.files[0]);
    }
  });
}

// ----------------------------------------------------
// API REQUESTS
// ----------------------------------------------------
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    globalConfig = await res.json();
    
    // Set theme class
    document.body.className = globalConfig.theme === 'dark' ? 'theme-dark' : 'theme-light';
    
    // Set theme switch checkbox
    const themeSwitchElement = document.getElementById('theme-switch');
    if (themeSwitchElement) {
      themeSwitchElement.checked = globalConfig.theme === 'dark';
    }
    
    // Populate form fields
    document.getElementById('setting-provider').value = globalConfig.provider;
    document.getElementById('setting-ollama-url').value = globalConfig.ollamaEndpoint;
    document.getElementById('setting-lmstudio-url').value = globalConfig.lmStudioEndpoint;
    document.getElementById('setting-temperature').value = globalConfig.temperature;
    valTemp.textContent = globalConfig.temperature;
    document.getElementById('setting-context').value = globalConfig.contextSize;
    document.getElementById('setting-embed-model').value = globalConfig.embeddingModel;
    document.getElementById('setting-template').value = globalConfig.promptTemplate;
    document.getElementById('setting-theme').value = globalConfig.theme;
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const data = {
    provider: document.getElementById('setting-provider').value,
    ollamaEndpoint: document.getElementById('setting-ollama-url').value,
    lmStudioEndpoint: document.getElementById('setting-lmstudio-url').value,
    temperature: parseFloat(document.getElementById('setting-temperature').value),
    contextSize: parseInt(document.getElementById('setting-context').value, 10),
    embeddingModel: document.getElementById('setting-embed-model').value,
    promptTemplate: document.getElementById('setting-template').value,
    theme: document.getElementById('setting-theme').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (res.ok) {
      closeModal(settingsModal);
      await loadSettings();
      await fetchModels();
      alert('Settings saved.');
    }
  } catch (err) {
    alert('Error saving settings: ' + err.message);
  }
}

async function fetchModels() {
  try {
    const res = await fetch('/api/models');
    availableModels = await res.json();
    
    modelSelector.innerHTML = '';
    
    // Filter models matching current provider
    const providerModels = availableModels.filter(m => m.provider === globalConfig.provider);
    
    if (providerModels.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = `No models found on ${globalConfig.provider}`;
      modelSelector.appendChild(opt);
    } else {
      providerModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        // Auto-select if matches global config model
        if (m.id === globalConfig.model) {
          opt.selected = true;
        }
        modelSelector.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error fetching models:', err);
  }
}

async function fetchWorkspaces() {
  try {
    const res = await fetch('/api/workspaces');
    workspaces = await res.json();
    renderWorkspaces();
  } catch (err) {
    console.error('Failed to list workspaces:', err);
  }
}

function renderWorkspaces() {
  workspaceList.innerHTML = '';
  workspaces.forEach(ws => {
    const li = document.createElement('li');
    li.dataset.name = ws.name;
    if (activeWorkspace === ws.name) li.className = 'active';
    
    const span = document.createElement('span');
    span.className = 'ws-name';
    span.textContent = ws.name;
    li.appendChild(span);
    
    li.addEventListener('click', () => selectWorkspace(ws.name));
    workspaceList.appendChild(li);
  });
}

async function selectWorkspace(name) {
  if (isGenerating) return;
  
  activeWorkspace = name;
  sessionStorage.setItem('lastActiveWorkspace', name);
  renderWorkspaces();
  
  // Enable Inputs
  promptInput.removeAttribute('disabled');
  btnSend.removeAttribute('disabled');
  btnAudio.removeAttribute('disabled');
  
  // Show header titles
  activeWorkspaceTitle.textContent = name;
  workspaceActions.style.display = 'flex';
  
  // Clear previous chat items
  chatMessages.innerHTML = '';
  sourcesBadgeContainer.style.display = 'none';

  try {
    // Load history
    const res = await fetch(`/api/workspaces/${name}/chat`);
    const data = await res.json();
    
    // Render messages
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => appendMessageUI(msg.sender, msg.text, msg.timestamp));
    } else {
      chatMessages.innerHTML = `<div class="welcome-message">
        <h2>${name}</h2>
        <p>This workspace is empty. Drop files here to index, or type a prompt below.</p>
      </div>`;
    }
    
    // Start index status polling
    startPollingIndexStatus();
    
    // Fetch files in workspace to populate viewer
    await fetchWorkspaceFiles();
    
  } catch (err) {
    console.error('Error loading workspace data:', err);
  }
}

async function handleCreateWorkspace() {
  const name = createWsInput.value.trim();
  if (!name) return;
  
  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    if (res.ok) {
      closeModal(createModal);
      const data = await res.json();
      await fetchWorkspaces();
      await selectWorkspace(data.name);
    } else {
      const err = await res.json();
      alert('Error: ' + err.error);
    }
  } catch (err) {
    alert('Error creating workspace: ' + err.message);
  }
}

async function handleRenameWorkspace() {
  const newName = renameWsInput.value.trim();
  if (!newName || newName === activeWorkspace) return;

  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName })
    });

    if (res.ok) {
      closeModal(renameModal);
      const data = await res.json();
      await fetchWorkspaces();
      await selectWorkspace(data.name);
    } else {
      const err = await res.json();
      alert('Rename failed: ' + err.error);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function handleDeleteWorkspace() {
  if (!confirm(`Are you sure you want to delete workspace "${activeWorkspace}"? All files and chat logs will be lost forever.`)) return;

  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      activeWorkspace = null;
      sessionStorage.removeItem('lastActiveWorkspace');
      workspaceActions.style.display = 'none';
      activeWorkspaceTitle.textContent = 'Select or Create a Workspace';
      chatMessages.innerHTML = '';
      promptInput.setAttribute('disabled', 'true');
      btnSend.setAttribute('disabled', 'true');
      btnAudio.setAttribute('disabled', 'true');
      
      stopPollingIndexStatus();
      fileViewerDrawer.classList.add('hidden');
      
      await fetchWorkspaces();
    }
  } catch (err) {
    alert('Delete error: ' + err.message);
  }
}

function handleExportWorkspace() {
  if (!activeWorkspace) return;
  window.open(`/api/workspaces/${activeWorkspace}/export`);
}

async function handleImportWorkspace(e) {
  const file = e.target.files[0];
  if (!file) return;
  await uploadZipWorkspace(file);
}

async function uploadZipWorkspace(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch('/api/workspaces/import', {
      method: 'POST',
      body: formData
    });
    
    if (res.ok) {
      const data = await res.json();
      alert(`Workspace "${data.name}" imported successfully.`);
      await fetchWorkspaces();
      await selectWorkspace(data.name);
    } else {
      const err = await res.json();
      alert('Import failed: ' + err.error);
    }
  } catch (err) {
    alert('Import error: ' + err.message);
  }
}

// ----------------------------------------------------
// CHAT OPERATIONS & SSE STREAMING
// ----------------------------------------------------
function appendMessageUI(sender, text, timestamp = new Date().toISOString()) {
  // Remove welcome message if present
  const welcome = chatMessages.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const item = document.createElement('div');
  item.className = `message-item ${sender.toLowerCase()}`;
  
  const header = document.createElement('div');
  header.className = 'message-header';
  
  const nameSpan = document.createElement('span');
  nameSpan.textContent = sender;
  header.appendChild(nameSpan);
  
  const timeSpan = document.createElement('span');
  timeSpan.textContent = new Date(timestamp).toLocaleTimeString();
  header.appendChild(timeSpan);
  
  item.appendChild(header);
  
  const body = document.createElement('div');
  body.className = 'message-body markdown-body';
  // Parse Markdown
  body.innerHTML = marked.parse(text);
  item.appendChild(body);
  
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Highlight code blocks
  Prism.highlightAllUnder(body);
  
  return item;
}

function updateMessageContent(element, text) {
  const body = element.querySelector('.message-body');
  body.innerHTML = marked.parse(text);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  Prism.highlightAllUnder(body);
}

async function toggleAudioRecording() {
  if (isRecording) {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Your browser does not support audio recording.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.addEventListener('dataavailable', (event) => {
      audioChunks.push(event.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(track => track.stop());
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      await uploadVoiceAudio(audioBlob);
    });

    mediaRecorder.start();
    isRecording = true;
    btnAudio.classList.add('recording');
    btnAudio.title = "Stop Recording";
    promptInput.placeholder = "Recording voice... Click mic again to stop.";
    promptInput.setAttribute('disabled', 'true');
    btnSend.setAttribute('disabled', 'true');
  } catch (err) {
    console.error("Microphone access failed:", err);
    alert("Failed to access microphone: " + err.message);
  }
}

async function uploadVoiceAudio(blob) {
  btnAudio.setAttribute('disabled', 'true');
  btnAudio.classList.remove('recording');
  btnAudio.title = "Transcribing...";
  promptInput.placeholder = "Transcribing voice via Whisper...";

  const formData = new FormData();
  formData.append('audio', blob, 'voice.webm');

  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/transcribe`, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      if (data.text) {
        if (promptInput.value) {
          promptInput.value += ' ' + data.text;
        } else {
          promptInput.value = data.text;
        }
        promptInput.style.height = 'auto';
        promptInput.style.height = promptInput.scrollHeight + 'px';
      } else {
        alert("Whisper did not detect any speech in the audio.");
      }
    } else {
      const err = await res.json();
      alert("Transcription failed: " + (err.error || 'Unknown error'));
    }
  } catch (err) {
    console.error("Transcription upload failed:", err);
    alert("Error uploading voice file: " + err.message);
  } finally {
    isRecording = false;
    btnAudio.removeAttribute('disabled');
    btnAudio.title = "Voice Input (Whisper)";
    promptInput.placeholder = "Type a message or ask a question about your files...";
    promptInput.removeAttribute('disabled');
    btnSend.removeAttribute('disabled');
    promptInput.focus();
  }
}

async function sendMessage() {
  if (isGenerating || !activeWorkspace) return;
  
  const text = promptInput.value.trim();
  if (!text) return;
  
  promptInput.value = '';
  promptInput.style.height = 'auto';
  
  // Add User Message UI
  appendMessageUI('User', text);
  
  // Prepare Assistant UI
  const assistantMsgEl = appendMessageUI('Assistant', 'Thinking...');
  
  isGenerating = true;
  promptInput.setAttribute('disabled', 'true');
  btnSend.setAttribute('disabled', 'true');
  btnAudio.setAttribute('disabled', 'true');
  sourcesBadgeContainer.style.display = 'none';
  sourcesBadges.innerHTML = '';

  try {
    const response = await fetch(`/api/workspaces/${activeWorkspace}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        model: modelSelector.value,
        provider: globalConfig.provider,
        temperature: globalConfig.temperature
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      const chunkStr = decoder.decode(value, { stream: true });
      const lines = chunkStr.split('\n');
      
      for (const line of lines) {
        if (line.trim().startsWith('data:')) {
          try {
            const data = JSON.parse(line.trim().substring(5));
            if (data.status === 'found_context' && data.sources) {
              renderSourcesBadges(data.sources);
            } else if (data.chunk) {
              accumulatedText += data.chunk;
              updateMessageContent(assistantMsgEl, accumulatedText);
            } else if (data.status === 'finished') {
              accumulatedText = data.text;
              updateMessageContent(assistantMsgEl, accumulatedText);
            } else if (data.status === 'error') {
              accumulatedText += `\n\n[Error: ${data.error}]`;
              updateMessageContent(assistantMsgEl, accumulatedText);
            }
          } catch (e) {
            // Incomplete JSON chunk
          }
        }
      }
    }
  } catch (err) {
    updateMessageContent(assistantMsgEl, `[Failed to get response: ${err.message}]`);
  } finally {
    isGenerating = false;
    promptInput.removeAttribute('disabled');
    btnSend.removeAttribute('disabled');
    btnAudio.removeAttribute('disabled');
    promptInput.focus();
  }
}

function renderSourcesBadges(sources) {
  sourcesBadges.innerHTML = '';
  if (!sources || sources.length === 0) {
    sourcesBadgeContainer.style.display = 'none';
    return;
  }
  
  sources.forEach(src => {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = src.filename;
    badge.title = `Author: ${src.author}\nTopics: ${src.topics.join(', ')}`;
    badge.addEventListener('click', () => {
      fileViewerDrawer.classList.remove('hidden');
      drawerFileSelect.value = src.filename;
      selectFileForViewer(src.filename);
    });
    sourcesBadges.appendChild(badge);
  });
  
  sourcesBadgeContainer.style.display = 'flex';
}

// ----------------------------------------------------
// FILE UPLOAD & INDEXING POLL
// ----------------------------------------------------
async function handleUploadFiles(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  await uploadFilesDirect(Array.from(files));
}

async function uploadFilesDirect(filesList) {
  const formData = new FormData();
  filesList.forEach(file => {
    formData.append('files', file);
  });

  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/upload`, {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      alert('Files uploaded successfully! Background indexing started.');
      await fetchWorkspaceFiles();
    } else {
      const err = await res.json();
      alert('Upload failed: ' + err.error);
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  }
}

function startPollingIndexStatus() {
  stopPollingIndexStatus();
  pollIndexStatusAction();
  indexingPollInterval = setInterval(pollIndexStatusAction, 3000);
}

function stopPollingIndexStatus() {
  if (indexingPollInterval) {
    clearInterval(indexingPollInterval);
    indexingPollInterval = null;
  }
  indexingIndicator.style.display = 'none';
}

async function pollIndexStatusAction() {
  if (!activeWorkspace) return;
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/index/status`);
    const data = await res.json();
    
    // Count files queued or processing
    const fileEntries = Object.entries(data.files || {});
    const pending = fileEntries.filter(([_, info]) => 
      info.status === 'queued' || info.status === 'processing'
    );
    
    if (pending.length > 0) {
      indexingIndicator.style.display = 'flex';
      indexingStatusText.textContent = `Indexing ${pending.length} file(s)...`;
    } else {
      indexingIndicator.style.display = 'none';
    }
  } catch (e) {
    console.error('Error polling indexing status:', e);
  }
}

// ----------------------------------------------------
// FILE VIEWER DRAWER
// ----------------------------------------------------
async function fetchWorkspaceFiles() {
  if (!activeWorkspace) return;
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/assets`);
    const assets = await res.json();
    
    const previousSelection = drawerFileSelect.value;
    
    drawerFileSelect.innerHTML = '';
    if (assets.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No files uploaded';
      drawerFileSelect.appendChild(opt);
      activeFile = null;
      clearViewerContent();
      return;
    }

    assets.forEach(asset => {
      const opt = document.createElement('option');
      opt.value = asset.filename;
      opt.textContent = `${asset.filename} (${asset.status})`;
      drawerFileSelect.appendChild(opt);
    });

    // Restore previous selection if still available
    const stillExists = assets.some(a => a.filename === previousSelection);
    if (stillExists) {
      drawerFileSelect.value = previousSelection;
      activeFile = previousSelection;
    } else {
      drawerFileSelect.value = assets[0].filename;
      activeFile = assets[0].filename;
      selectFileForViewer(assets[0].filename);
    }
  } catch (err) {
    console.error('Error fetching workspace assets:', err);
  }
}

function clearViewerContent() {
  summaryViewerContent.innerHTML = '<p class="placeholder-text">No summary available.</p>';
  metadataViewerContent.textContent = '# No metadata loaded';
  extractedViewerContent.innerHTML = '<p class="placeholder-text">No extracted content available.</p>';
  originalViewerContent.innerHTML = '<p class="placeholder-text">Preview not available for this file.</p>';
}

async function selectFileForViewer(filename) {
  if (!filename) {
    clearViewerContent();
    return;
  }
  
  activeFile = filename;
  
  // 1. Fetch Summary
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/summaries/${filename}`);
    if (res.ok) {
      const text = await res.text();
      summaryViewerContent.innerHTML = marked.parse(text);
    } else {
      summaryViewerContent.innerHTML = '<p class="placeholder-text">Summary is generating/not available.</p>';
    }
  } catch (e) {
    summaryViewerContent.innerHTML = '<p class="placeholder-text">Error loading summary.</p>';
  }

  // 2. Fetch Metadata
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/metadata/${filename}`);
    if (res.ok) {
      const yamlData = await res.json();
      // Format as string representation of yaml
      const formatted = jsYamlDump(yamlData);
      metadataViewerContent.textContent = formatted;
      Prism.highlightElement(metadataViewerContent);
    } else {
      metadataViewerContent.textContent = '# Metadata is generating/not available.';
    }
  } catch (e) {
    metadataViewerContent.textContent = '# Error loading metadata.';
  }

  // 3. Fetch Extracted MD
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/extracted/${filename}`);
    if (res.ok) {
      const text = await res.text();
      extractedViewerContent.innerHTML = marked.parse(text);
      Prism.highlightAllUnder(extractedViewerContent);
    } else {
      extractedViewerContent.innerHTML = '<p class="placeholder-text">Extracted markdown is generating/not available.</p>';
    }
  } catch (e) {
    extractedViewerContent.innerHTML = '<p class="placeholder-text">Error loading extracted markdown.</p>';
  }

  // 4. Original Preview
  const originalUrl = `/api/workspaces/${activeWorkspace}/files/${filename}`;
  const ext = filename.split('.').pop().toLowerCase();
  
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
    originalViewerContent.innerHTML = `<img src="${originalUrl}" class="image-preview" alt="${filename}">`;
  } else if (['txt', 'md', 'json', 'yaml', 'yml', 'csv'].includes(ext)) {
    try {
      const res = await fetch(originalUrl);
      const text = await res.text();
      originalViewerContent.innerHTML = `<pre class="text-preview"><code>${escapeHtml(text)}</code></pre>`;
    } catch (e) {
      originalViewerContent.innerHTML = '<p class="placeholder-text">Error loading text preview.</p>';
    }
  } else if (ext === 'pdf') {
    originalViewerContent.innerHTML = `<iframe src="${originalUrl}" width="100%" height="500px" style="border: none;"></iframe>`;
  } else {
    originalViewerContent.innerHTML = `<p class="placeholder-text">Preview not supported for .${ext} files. <a href="${originalUrl}" target="_blank" download>Download Original File</a></p>`;
  }
}

async function handleReindexActiveFile() {
  if (!activeWorkspace || !activeFile) return;
  
  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/index/reindex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: activeFile })
    });
    
    if (res.ok) {
      alert(`Re-indexing triggered for ${activeFile}`);
      startPollingIndexStatus();
    }
  } catch (e) {
    alert('Re-indexing error: ' + e.message);
  }
}

function handleToggleFilesDrawer() {
  if (!activeWorkspace) return;
  fileViewerDrawer.classList.toggle('hidden');
  if (!fileViewerDrawer.classList.contains('hidden')) {
    fetchWorkspaceAssets();
  }
}

async function handleRenameActiveFile() {
  if (!activeWorkspace || !activeFile) return;
  
  const currentFilename = activeFile;
  const newFilename = prompt("Enter new filename:", currentFilename);
  
  if (!newFilename || newFilename.trim() === '' || newFilename === currentFilename) {
    return;
  }

  // Basic validation to check extension matches if there was one
  const oldExt = currentFilename.split('.').pop().toLowerCase();
  const newExt = newFilename.split('.').pop().toLowerCase();
  if (oldExt !== newExt) {
    const confirmExt = confirm(`Warning: You are changing the file extension from .${oldExt} to .${newExt}. Are you sure you want to proceed?`);
    if (!confirmExt) return;
  }

  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/files/${encodeURIComponent(currentFilename)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: newFilename })
    });

    if (res.ok) {
      drawerFileSelect.value = newFilename;
      activeFile = newFilename;
      await fetchWorkspaceAssets();
      selectFileForViewer(newFilename);
    } else {
      const err = await res.json();
      alert(`Failed to rename file: ${err.error}`);
    }
  } catch (e) {
    console.error('Error renaming file:', e);
    alert('An error occurred while renaming the file.');
  }
}

async function handleDeleteActiveFile() {
  if (!activeWorkspace || !activeFile) return;

  const filename = activeFile;
  const confirmDelete = confirm(`Are you sure you want to delete "${filename}"? This will delete the file and all its generated summaries/extracted text.`);
  if (!confirmDelete) return;

  try {
    const res = await fetch(`/api/workspaces/${activeWorkspace}/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      drawerFileSelect.value = '';
      activeFile = null;
      await fetchWorkspaceAssets();
    } else {
      const err = await res.json();
      alert(`Failed to delete file: ${err.error}`);
    }
  } catch (e) {
    console.error('Error deleting file:', e);
    alert('An error occurred while deleting the file.');
  }
}

// Simple YAML dump helper (to avoid importing heavy external js-yaml on frontend)
function jsYamlDump(obj, indent = '') {
  let str = '';
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      str += `${indent}${key}: null\n`;
    } else if (typeof value === 'object') {
      if (Array.isArray(value)) {
        str += `${indent}${key}:\n`;
        value.forEach(item => {
          str += `${indent}  - "${String(item).replace(/"/g, '\\"')}"\n`;
        });
      } else {
        str += `${indent}${key}:\n`;
        str += jsYamlDump(value, indent + '  ');
      }
    } else {
      str += `${indent}${key}: "${String(value).replace(/"/g, '\\"')}"\n`;
    }
  }
  return str;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start Application
init();
