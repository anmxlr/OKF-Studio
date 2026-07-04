import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store config.yaml in the root of the project workspace
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.yaml');

const DEFAULT_CONFIG = {
  ollamaEndpoint: 'http://localhost:11434',
  lmStudioEndpoint: 'http://localhost:1234/v1',
  provider: 'ollama', // 'ollama' or 'lmstudio'
  model: 'llama3', // placeholder, will auto-detect or let user select
  embeddingModel: 'nomic-embed-text',
  temperature: 0.7,
  contextSize: 2048,
  promptTemplate: `You are a helpful local AI assistant. Use the following context retrieved from the workspace documents to answer the question. If the context doesn't contain the answer, use your general knowledge but make it clear.

Context:
{{context}}

Question:
{{question}}

Answer:`,
  theme: 'light'
};

export function getProjectRoot() {
  return PROJECT_ROOT;
}

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const fileContents = fs.readFileSync(CONFIG_PATH, 'utf8');
      const loaded = yaml.load(fileContents);
      return { ...DEFAULT_CONFIG, ...loaded };
    }
  } catch (error) {
    console.error('Error loading config, using defaults:', error);
  }
  
  // If config doesn't exist, write the default one
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export function saveConfig(newConfig) {
  try {
    const yamlStr = yaml.dump(newConfig, { indent: 2 });
    fs.writeFileSync(CONFIG_PATH, yamlStr, 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}
