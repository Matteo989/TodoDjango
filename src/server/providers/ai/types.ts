/** Abstraction IA (§26). Aucune dépendance à un fournisseur hors des implémentations. */

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface AIResult<T> {
  data: T;
  usage: AIUsage;
  model: string;
  provider: string;
}

export interface GenerateOptions {
  /** Contexte système. Les implémentations doivent le respecter tel quel. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Identifie la version du prompt dans les logs, pour comparer les résultats. */
  promptVersion?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  /** False pour les mocks: l'UI l'affiche, rien n'est présenté comme branché à tort. */
  readonly isLive: boolean;

  generateText(prompt: string, options?: GenerateOptions): Promise<AIResult<string>>;

  /**
   * `schemaName` et `schemaHint` décrivent la forme attendue. L'implémentation
   * est responsable de renvoyer un objet conforme ou de lever une erreur —
   * jamais un JSON partiel silencieusement accepté.
   */
  generateStructuredOutput<T>(
    prompt: string,
    schemaName: string,
    schemaHint: string,
    options?: GenerateOptions,
  ): Promise<AIResult<T>>;

  /** Null si le fournisseur ne propose pas d'embeddings: l'appelant bascule en lexical. */
  embed(texts: string[]): Promise<AIResult<number[][]> | null>;
}
