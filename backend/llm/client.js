import { loadConfig } from '../shared/config.js';

/**
 * Helper to fetch with timeout
 */
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * Fetch available models from Ollama and LM Studio
 */
export async function getModels() {
  const config = loadConfig();
  const models = [];

  // Try fetching from Ollama
  try {
    const ollamaUrl = `${config.ollamaEndpoint}/api/tags`;
    const response = await fetchWithTimeout(ollamaUrl, { timeout: 3000 });
    if (response.ok) {
      const data = await response.json();
      if (data.models && Array.isArray(data.models)) {
        data.models.forEach(m => {
          models.push({
            id: m.name,
            name: m.name,
            provider: 'ollama'
          });
        });
      }
    }
  } catch (err) {
    console.log('Ollama is not running or unreachable at', config.ollamaEndpoint);
  }

  // Try fetching from LM Studio
  try {
    const lmStudioUrl = `${config.lmStudioEndpoint}/models`;
    const response = await fetchWithTimeout(lmStudioUrl, { timeout: 3000 });
    if (response.ok) {
      const data = await response.json();
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach(m => {
          models.push({
            id: m.id,
            name: m.id,
            provider: 'lmstudio'
          });
        });
      }
    }
  } catch (err) {
    console.log('LM Studio is not running or unreachable at', config.lmStudioEndpoint);
  }

  return models;
}

/**
 * Run chat completion (supports streaming)
 * @param {Array} messages - [{role: 'user', content: '...'}, ...]
 * @param {Object} options - Override config parameters (model, provider, etc.)
 * @param {Function} onChunk - Callback for stream chunks (if streaming)
 */
export async function chatCompletion(messages, options = {}, onChunk = null) {
  const config = loadConfig();
  const provider = options.provider || config.provider;
  const model = options.model || config.model;
  const temperature = options.temperature !== undefined ? options.temperature : config.temperature;
  const systemPrompt = options.systemPrompt || '';

  // Format messages to include system prompt if provided
  const chatMessages = [...messages];
  if (systemPrompt && !chatMessages.some(m => m.role === 'system')) {
    chatMessages.unshift({ role: 'system', content: systemPrompt });
  }

  if (provider === 'ollama') {
    return await handleOllamaChat(chatMessages, model, temperature, config.ollamaEndpoint, onChunk);
  } else {
    return await handleLmStudioChat(chatMessages, model, temperature, config.lmStudioEndpoint, onChunk);
  }
}

/**
 * Generate text embeddings
 */
export async function getEmbeddings(text) {
  const config = loadConfig();
  const provider = config.provider;
  const embedModel = config.embeddingModel;

  if (provider === 'ollama') {
    try {
      const res = await fetch(`${config.ollamaEndpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: embedModel,
          prompt: text
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
    } catch (err) {
      console.error('Ollama embedding error:', err);
    }
  } else {
    // LM Studio
    try {
      const res = await fetch(`${config.lmStudioEndpoint}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: embedModel,
          input: text
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.data[0].embedding;
      }
    } catch (err) {
      console.error('LM Studio embedding error:', err);
    }
  }

  // Return a mock embedding array if call fails (to avoid crashing downstream tasks)
  return new Array(384).fill(0).map(() => Math.random() - 0.5);
}

// ----------------------------------------------------
// PROVIDER SPECIFIC LOGIC
// ----------------------------------------------------

async function handleOllamaChat(messages, model, temperature, endpoint, onChunk) {
  const url = `${endpoint}/api/chat`;
  
  // Format role for Ollama (user, assistant, system)
  const ollamaMessages = messages.map(m => ({
    role: m.role || (m.sender === 'User' ? 'user' : 'assistant'),
    content: m.content || m.text || ''
  }));

  const body = {
    model: model,
    messages: ollamaMessages,
    options: {
      temperature: temperature
    },
    stream: !!onChunk
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama chat error (${response.status}): ${errorText}`);
  }

  if (!onChunk) {
    const data = await response.json();
    return data.message.content;
  }

  // Handle streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let finished = false;
  let fullText = '';

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) {
      finished = true;
      break;
    }
    
    const chunk = decoder.decode(value, { stream: true });
    // Ollama streams JSON lines
    const lines = chunk.split('\n').filter(l => l.trim() !== '');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          const textChunk = parsed.message.content;
          fullText += textChunk;
          onChunk(textChunk);
        }
      } catch (err) {
        // Handle partial JSON chunk across buffer lines
      }
    }
  }
  return fullText;
}

async function handleLmStudioChat(messages, model, temperature, endpoint, onChunk) {
  const url = `${endpoint}/chat/completions`;
  
  const openaiMessages = messages.map(m => ({
    role: m.role || (m.sender === 'User' ? 'user' : 'assistant'),
    content: m.content || m.text || ''
  }));

  const body = {
    model: model,
    messages: openaiMessages,
    temperature: temperature,
    stream: !!onChunk
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LM Studio chat error (${response.status}): ${errorText}`);
  }

  if (!onChunk) {
    const data = await response.json();
    return data.choices[0].message.content;
  }

  // Handle SSE streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let finished = false;
  let fullText = '';
  let partialLine = '';

  while (!finished) {
    const { value, done } = await reader.read();
    if (done) {
      finished = true;
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    const lines = (partialLine + chunk).split('\n');
    partialLine = lines.pop(); // save the last incomplete line

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine.startsWith('data:')) continue;
      
      const dataStr = cleanLine.substring(5).trim();
      if (dataStr === '[DONE]') {
        finished = true;
        break;
      }

      try {
        const parsed = JSON.parse(dataStr);
        const textChunk = parsed.choices[0]?.delta?.content;
        if (textChunk) {
          fullText += textChunk;
          onChunk(textChunk);
        }
      } catch (err) {
        // JSON parsing error (likely incomplete line)
      }
    }
  }
  return fullText;
}
