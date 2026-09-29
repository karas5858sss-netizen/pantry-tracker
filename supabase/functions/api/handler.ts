import type { ApiDependencies } from './types.ts';
import { validateTelegramInitData } from '../../../shared/telegramAuth.ts';
import { handleSession } from './session.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

function addCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export async function handleApiRequest(req: Request, deps: ApiDependencies): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // Extract Authorization header: "tma <initDataRaw>"
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('tma ')) {
    return addCors(
      new Response(
        JSON.stringify({
          error: 'Отсутствует или некорректен заголовок авторизации (ожидается: Authorization: tma <initData>)',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
  }

  const initDataRaw = authHeader.slice(4).trim();
  const now = deps.now ? deps.now() : new Date();
  const authResult = await validateTelegramInitData(initDataRaw, deps.botToken, now);

  if (!authResult.isValid || !authResult.data) {
    return addCors(
      new Response(
        JSON.stringify({
          error: authResult.error || 'Ошибка авторизации',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
  }

  const user = authResult.data.user;
  const url = new URL(req.url);
  const pathname = url.pathname.replace(/^\/api/, ''); // Support both /session and /api/session

  if (pathname === '/session' && req.method === 'POST') {
    const res = await handleSession(user, req, deps);
    return addCors(res);
  }

  return addCors(
    new Response(
      JSON.stringify({
        error: `Маршрут ${req.method} ${pathname} не найден`,
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  );
}
