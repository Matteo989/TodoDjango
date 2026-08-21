import type { Platform } from '@prisma/client';
import type { PublishInput, PublishResult, PublishingProvider } from './types';

/**
 * Publication YouTube via l'API Data v3 (upload resumable).
 *
 * L'appel réseau est implémenté; ce qui manque est le flux OAuth utilisateur
 * (consentement + rafraîchissement du jeton), qui appartient à la phase 2. Sans
 * jeton valide, ce provider renvoie MANUAL_REQUIRED plutôt que de prétendre
 * avoir publié.
 */
export class YouTubePublishingProvider implements PublishingProvider {
  readonly id = 'youtube';
  readonly isLive = true;

  supports(platform: Platform): boolean {
    return platform === 'YOUTUBE_SHORTS';
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!this.supports(input.platform)) {
      return {
        outcome: 'MANUAL_REQUIRED',
        manualReason: `Le provider YouTube ne gère pas ${input.platform}.`,
      };
    }

    if (!input.accountToken) {
      return {
        outcome: 'MANUAL_REQUIRED',
        manualReason:
          "Aucun jeton OAuth YouTube pour ce compte. Connectez le compte dans Settings → Comptes sociaux.",
      };
    }

    const metadata = {
      snippet: {
        title: input.title.slice(0, 100),
        description: [input.description, input.hashtags.map((h) => `#${h}`).join(' ')]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 5000),
        tags: input.hashtags.slice(0, 15),
        categoryId: '26', // Howto & Style
      },
      status: {
        privacyStatus: input.scheduledAt ? 'private' : 'public',
        ...(input.scheduledAt ? { publishAt: input.scheduledAt.toISOString() } : {}),
        selfDeclaredMadeForKids: false,
      },
    };

    try {
      const init = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.accountToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'video/mp4',
          },
          body: JSON.stringify(metadata),
        },
      );

      if (!init.ok) {
        return {
          outcome: 'FAILED',
          error: `YouTube init ${init.status}: ${(await init.text()).slice(0, 400)}`,
        };
      }

      const uploadUrl = init.headers.get('location');
      if (!uploadUrl) {
        return { outcome: 'FAILED', error: "YouTube n'a pas renvoyé d'URL d'upload." };
      }

      const { readFile } = await import('node:fs/promises');
      const body = await readFile(input.filePath);

      const upload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(body.byteLength) },
        body,
      });

      if (!upload.ok) {
        return {
          outcome: 'FAILED',
          error: `YouTube upload ${upload.status}: ${(await upload.text()).slice(0, 400)}`,
        };
      }

      const json = (await upload.json()) as { id?: string };
      if (!json.id) return { outcome: 'FAILED', error: 'Réponse YouTube sans identifiant vidéo.' };

      return {
        outcome: input.scheduledAt ? 'SCHEDULED' : 'PUBLISHED',
        externalId: json.id,
        externalUrl: `https://www.youtube.com/shorts/${json.id}`,
      };
    } catch (error) {
      return { outcome: 'FAILED', error: (error as Error).message };
    }
  }
}
