import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ForbiddenError, UnauthorizedError } from '@/server/auth/guard';
import { ComplianceError } from '@/lib/compliance/guards';

/**
 * Traduction uniforme des erreurs de service en réponses HTTP.
 * Les Route Handlers ne contiennent aucune logique métier: ils valident,
 * appellent un service, et laissent cette fonction traduire les échecs.
 */
export function apiError(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ComplianceError) {
    // 422: la requête est bien formée, c'est la règle métier qui refuse.
    return NextResponse.json(
      { error: error.message, code: error.code, remedy: error.remedy },
      { status: 422 },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Requête invalide.',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 });
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
