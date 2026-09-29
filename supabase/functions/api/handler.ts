import type { ApiDependencies } from './types.ts';
import { validateTelegramInitData } from '../../../shared/telegramAuth.ts';
import { handleSession } from './session.ts';
import {
  handleCreatePantry,
  handleCreateInvite,
  handleJoinInvite,
  handleLeavePantry,
  handleDeletePantry,
  handleRemoveMember,
  handleGetMembers,
  handleUpdateWriteAccess,
} from './pantries.ts';
import { handleGetProduct, handleUpsertProduct } from './products.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const pathname = url.pathname.replace(/^\/api/, ''); // Support /pantries and /api/pantries

  // Route: POST /session
  if (pathname === '/session' && req.method === 'POST') {
    const res = await handleSession(user, req, deps);
    return addCors(res);
  }

  // Route: POST /user/write-access
  if (pathname === '/user/write-access' && req.method === 'POST') {
    const res = await handleUpdateWriteAccess(user, req, deps);
    return addCors(res);
  }

  // Route: POST /pantries (create new pantry)
  if (pathname === '/pantries' && req.method === 'POST') {
    const res = await handleCreatePantry(user, req, deps);
    return addCors(res);
  }

  // Route: POST /invites/join (join via invite code)
  if (pathname === '/invites/join' && req.method === 'POST') {
    const res = await handleJoinInvite(user, req, deps);
    return addCors(res);
  }

  // Route: POST /pantries/:id/invites (create invite)
  const inviteMatch = pathname.match(/^\/pantries\/([^/]+)\/invites$/);
  if (inviteMatch && req.method === 'POST') {
    const pantryId = inviteMatch[1];
    const res = await handleCreateInvite(user, pantryId, deps);
    return addCors(res);
  }

  // Route: POST /pantries/:id/leave (member leaves)
  const leaveMatch = pathname.match(/^\/pantries\/([^/]+)\/leave$/);
  if (leaveMatch && req.method === 'POST') {
    const pantryId = leaveMatch[1];
    const res = await handleLeavePantry(user, pantryId, deps);
    return addCors(res);
  }

  // Route: DELETE /pantries/:id (owner deletes pantry)
  const deleteMatch = pathname.match(/^\/pantries\/([^/]+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const pantryId = deleteMatch[1];
    const res = await handleDeletePantry(user, pantryId, deps);
    return addCors(res);
  }

  // Route: POST /pantries/:id/members/remove (owner removes member)
  const removeMemberMatch = pathname.match(/^\/pantries\/([^/]+)\/members\/remove$/);
  if (removeMemberMatch && req.method === 'POST') {
    const pantryId = removeMemberMatch[1];
    const res = await handleRemoveMember(user, pantryId, req, deps);
    return addCors(res);
  }

  // Route: GET /pantries/:id/members (list members)
  const getMembersMatch = pathname.match(/^\/pantries\/([^/]+)\/members$/);
  if (getMembersMatch && req.method === 'GET') {
    const pantryId = getMembersMatch[1];
    const res = await handleGetMembers(user, pantryId, deps);
    return addCors(res);
  }

  // Route: GET /products/:barcode (resolve barcode)
  const productMatch = pathname.match(/^\/products\/([^/]+)$/);
  if (productMatch && req.method === 'GET') {
    const barcode = productMatch[1];
    const lang = (url.searchParams.get('lang') || user.language_code || 'ru') as 'ru' | 'es' | 'en';
    const res = await handleGetProduct(user, barcode, lang, deps);
    return addCors(res);
  }

  // Route: POST /products (upsert product in catalog)
  if (pathname === '/products' && req.method === 'POST') {
    const res = await handleUpsertProduct(user, req, deps);
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
