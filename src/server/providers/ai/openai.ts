import type { AIProvider, AIResult, GenerateOptions } from './types';

/**
 * Implémentation OpenAI (et de tout endpoint compatible via OPENAI_BASE_URL:
 * Azure OpenAI, Together, Groq, Ollama en mode compatible…).
 *
 * Aucune dépendance au SDK: un fetch suffit, et cela évite d'imposer une version
 * de SDK à qui voudrait brancher un endpoint compatible.
 */

interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  embeddingModel: string;
}

/** Tarifs en centimes d'euro par million de tokens. Ajuster si le modèle change. */
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 14, output: 56 },
  'gpt-4o': { input: 230, output: 920 },
  'gpt-4.1-mini': { input: 37, output: 148 },
  'text-embedding-3-small': { input: 2, output: 0 },
};

const DEFAULT_PRICE = { input: 50, output: 150 };

function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_TABLE[model] ?? DEFAULT_PRICE;
  const cents = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  // Arrondi au centième de centime pour ne pas perdre les micro-coûts à l'agrégation.
  return Math.round(cents * 100) / 100;
}

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai';
  readonly isLive = true;
  readonly model: string;
  private readonly config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAIProvider requiert OPENAI_API_KEY.');
    }
    this.config = config;
    this.model = config.model;
  }

  private async chat(
    prompt: string,
    options: GenerateOptions | undefined,
    responseFormat?: { type: 'json_object' },
  ) {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        ...(options?.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.8,
    };
    if (options?.maxTokens) body['max_tokens'] = options.maxTokens;
    if (responseFormat) body['response_format'] = responseFormat;

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 500)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Réponse OpenAI sans contenu exploitable.');
    }

    const inputTokens = json.usage?.prompt_tokens ?? 0;
    const outputTokens = json.usage?.completion_tokens ?? 0;

    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
        costCents: estimateCostCents(this.config.model, inputTokens, outputTokens),
      },
    };
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<AIResult<string>> {
    const { content, usage } = await this.chat(prompt, options);
    return { data: content, usage, model: this.model, provider: this.id };
  }

  async generateStructuredOutput<T>(
    prompt: string,
    schemaName: string,
    schemaHint: string,
    options?: GenerateOptions,
  ): Promise<AIResult<T>> {
    const system = [
      options?.system ?? '',
      `Tu réponds EXCLUSIVEMENT par un objet JSON valide conforme au schéma "${schemaName}".`,
      `Schéma attendu:\n${schemaHint}`,
      "N'ajoute ni texte avant, ni texte après, ni bloc de code markdown.",
    ]
      .filter(Boolean)
      .join('\n\n');

    const { content, usage } = await this.chat(prompt, { ...options, system }, { type: 'json_object' });

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(content));
    } catch (error) {
      throw new Error(
        `Le modèle n'a pas renvoyé un JSON valide pour ${schemaName}: ${(error as Error).message}`,
      );
    }

    return { data: parsed as T, usage, model: this.model, provider: this.id };
  }

  async embed(texts: string[]): Promise<AIResult<number[][]> | null> {
    if (texts.length === 0) {
      return {
        data: [],
        usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
        model: this.config.embeddingModel,
        provider: this.id,
      };
    }

    const response = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ model: this.config.embeddingModel, input: texts }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI embeddings ${response.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens?: number };
    };

    const rows = (json.data ?? []).slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const inputTokens = json.usage?.prompt_tokens ?? 0;

    return {
      data: rows,
      usage: {
        inputTokens,
        outputTokens: 0,
        costCents: estimateCostCents(this.config.embeddingModel, inputTokens, 0),
      },
      model: this.config.embeddingModel,
      provider: this.id,
    };
  }
}

/** Certains modèles renvoient malgré tout un bloc ```json — on le retire. */
function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}
