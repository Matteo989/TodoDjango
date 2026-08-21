import { NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/guard';
import { storage } from '@/server/storage';
import { apiError } from '@/lib/api';
import { prisma } from '@/server/db';

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  ass: 'text/x-ssa',
};

type Params = { params: Promise<{ path: string[] }> };

/**
 * Sert les fichiers du stockage local.
 *
 * La clé commence toujours par l'identifiant du workspace: on vérifie
 * l'appartenance avant de lire, sinon une clé devinée exposerait les médias
 * d'un autre utilisateur.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const { path } = await params;
    const key = path.map(decodeURIComponent).join('/');

    const workspaceId = path[0] ? decodeURIComponent(path[0]) : '';
    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.userId, workspaceId } },
    });
    if (!membership) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
    }

    const store = storage();
    if (!(await store.exists(key))) {
      return NextResponse.json({ error: 'Fichier introuvable.' }, { status: 404 });
    }

    const buffer = await store.get(key);
    const extension = key.split('.').pop()?.toLowerCase() ?? '';

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
