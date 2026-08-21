import { z } from 'zod';

/**
 * Environnement serveur validé une seule fois. Toute clé absente devient une
 * chaîne vide et fait basculer le provider concerné en mode mock — jamais une
 * erreur de démarrage, pour que l'app tourne sans aucune clé d'API.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET doit faire au moins 16 caractères'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.string().default('true'),

  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  VOICE_PROVIDER: z.enum(['mock', 'elevenlabs', 'openai']).default('mock'),
  ELEVENLABS_API_KEY: z.string().default(''),
  ELEVENLABS_VOICE_ID: z.string().default(''),
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),

  VIDEO_PROVIDER: z.enum(['mock', 'runway', 'kling']).default('mock'),
  RUNWAY_API_KEY: z.string().default(''),
  KLING_API_KEY: z.string().default(''),

  PUBLISHING_PROVIDER: z.enum(['manual', 'youtube']).default('manual'),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  TIKTOK_CLIENT_ID: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  META_CLIENT_ID: z.string().default(''),
  META_CLIENT_SECRET: z.string().default(''),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  DUPLICATION_THRESHOLD: z.coerce.number().min(0).max(100).default(80),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration d'environnement invalide:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Ce que Settings affiche: quels providers sont réellement branchés. */
export function providerStatus() {
  const e = env();
  return {
    ai: {
      configured: e.AI_PROVIDER !== 'mock' && e.OPENAI_API_KEY.length > 0,
      selected: e.AI_PROVIDER,
      requires: 'OPENAI_API_KEY',
    },
    voice: {
      configured:
        (e.VOICE_PROVIDER === 'elevenlabs' && e.ELEVENLABS_API_KEY.length > 0) ||
        (e.VOICE_PROVIDER === 'openai' && e.OPENAI_API_KEY.length > 0),
      selected: e.VOICE_PROVIDER,
      requires: e.VOICE_PROVIDER === 'elevenlabs' ? 'ELEVENLABS_API_KEY' : 'OPENAI_API_KEY',
    },
    video: {
      configured: false,
      selected: e.VIDEO_PROVIDER,
      requires: 'RUNWAY_API_KEY / KLING_API_KEY (implémentation à fournir)',
    },
    publishing: {
      configured: e.PUBLISHING_PROVIDER === 'youtube' && e.YOUTUBE_CLIENT_ID.length > 0,
      selected: e.PUBLISHING_PROVIDER,
      requires: 'YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + OAuth utilisateur',
    },
    storage: { configured: true, selected: e.STORAGE_DRIVER, requires: 'S3_* en production' },
  };
}
