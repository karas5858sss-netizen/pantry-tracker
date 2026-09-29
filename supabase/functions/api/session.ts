import type { ApiDependencies, SessionResponse } from './types.ts';
import type { TelegramUser } from '../../../shared/telegramAuth.ts';
import { t, detectLanguage } from '../../../shared/i18n.ts';

export async function handleSession(
  user: TelegramUser,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  // 1. Check whitelist
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(
      JSON.stringify({
        error: 'Пользователь не найден в списке разрешенных (allowed_users)',
        code: 'NOT_ALLOWED',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 2. Check if user already registered
  const existingUser = await deps.db.getUser(user.id);

  if (!existingUser) {
    // New user registration - verify 10 user limit
    const currentUsersCount = await deps.db.getUsersCount();
    if (currentUsersCount >= 10) {
      return new Response(
        JSON.stringify({
          error: 'Превышен лимит пользователей проекта (максимум 10)',
          code: 'USER_LIMIT_REACHED',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // 3. Parse optional client timezone from request body
  let clientTimezone = 'Europe/Moscow';
  try {
    const body = await req.json();
    if (body?.timezone && typeof body.timezone === 'string') {
      clientTimezone = body.timezone;
    }
  } catch {
    // Body is optional or empty
  }

  // 4. Upsert user
  const savedUser = await deps.db.upsertUser({
    telegram_id: user.id,
    first_name: user.first_name,
    username: user.username || null,
    language_code: user.language_code || 'ru',
    timezone: clientTimezone,
  });

  // 5. Fetch or create personal pantry
  let pantries = await deps.db.getUserPantries(user.id);

  if (pantries.length === 0) {
    const lang = detectLanguage(user.language_code);
    const defaultPantryName = t(lang, 'pantry_default_name');
    const newPantry = await deps.db.createPantry(defaultPantryName, user.id);
    pantries = [newPantry];
  }

  const responsePayload: SessionResponse = {
    user: savedUser,
    pantries,
    currentPantry: pantries[0],
  };

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
