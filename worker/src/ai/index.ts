import { logger } from '../logger.js';

export interface AIClient {
  chat(prompt: string): Promise<string>;
  provider: string;
}

export interface AnalysisResult {
  rootCause: string;
  confidence: number;
  suggestedFix: string;
  shouldRetry: boolean;
  retryDelay: number | null;
  category: 'transient' | 'permanent' | 'config';
}

const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama';
const AI_MODEL = process.env.AI_MODEL || 'llama3.2';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

class OllamaClient implements AIClient {
  provider = 'ollama';

  async chat(prompt: string): Promise<string> {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.3 }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }
}

class OpenAIClient implements AIClient {
  provider = 'openai';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }

  async chat(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI error: ${response.status} ${error}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content || '';
  }
}

class AnthropicClient implements AIClient {
  provider = 'anthropic';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
  }

  async chat(prompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: AI_MODEL || 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} ${error}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text || '';
  }
}

class GeminiClient implements AIClient {
  provider = 'gemini';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
  }

  async chat(prompt: string): Promise<string> {
    const model = AI_MODEL || 'gemini-1.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    };
    return data.candidates[0]?.content?.parts[0]?.text || '';
  }
}

let aiClient: AIClient | null = null;

export function getAIClient(): AIClient | null {
  if (aiClient) return aiClient;

  try {
    switch (AI_PROVIDER.toLowerCase()) {
      case 'ollama':
        aiClient = new OllamaClient();
        break;
      case 'openai':
        aiClient = new OpenAIClient();
        break;
      case 'anthropic':
        aiClient = new AnthropicClient();
        break;
      case 'gemini':
        aiClient = new GeminiClient();
        break;
      default:
        logger.warn({ provider: AI_PROVIDER }, 'unknown_ai_provider');
        return null;
    }
    logger.info({ provider: AI_PROVIDER, model: AI_MODEL }, 'ai_client_initialized');
    return aiClient;
  } catch (err) {
    logger.warn({ err, provider: AI_PROVIDER }, 'ai_client_init_failed');
    return null;
  }
}

export function isAIEnabled(): boolean {
  return !!process.env.AI_PROVIDER;
}
