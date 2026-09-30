import type { ApiDependencies } from './types.ts';
import type { TelegramUser } from '../../../shared/telegramAuth.ts';
import { generateInviteCode, formatInviteLink, isValidInviteCode } from '../../../shared/invites.ts';
import {
  getUserLocalDate,
  calculateDaysRemaining,
  categorizeReminderStage,
  formatPantryReminderHtml,
  type ReminderItem,
} from '../../../shared/reminders.ts';
import { t, type SupportedLanguage } from '../../../shared/i18n.ts';

export async function handleCreatePantry(
  user: TelegramUser,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Пользователь не в whitelist', code: 'NOT_ALLOWED' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let name = 'Склад';
  try {
    const body = await req.json();
    if (body?.name && typeof body.name === 'string' && body.name.trim()) {
      name = body.name.trim();
    }
  } catch {
    // default name
  }

  const pantry = await deps.db.createPantry(name, user.id);
  return new Response(JSON.stringify({ pantry }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleCreateInvite(
  user: TelegramUser,
  pantryId: string,
  deps: ApiDependencies
): Promise<Response> {
  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Нет доступа к данному складу', code: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const code = generateInviteCode(24);
  const now = deps.now ? deps.now() : new Date();
  // 48 hours validity
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const maxUses = 1;

  const invite = await deps.db.createPantryInvite(pantryId, user.id, code, expiresAt, maxUses);
  const botName = deps.botUsername || 'sklad_jli_bot';
  const appShortName = deps.appShortName || 'app';
  const inviteUrl = formatInviteLink(botName, appShortName, invite.code);

  return new Response(
    JSON.stringify({
      code: invite.code,
      inviteUrl,
      expiresAt: invite.expires_at,
      maxUses: invite.max_uses,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function handleJoinInvite(
  user: TelegramUser,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  // 1. Whitelist verification
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

  let code = '';
  try {
    const body = await req.json();
    if (body?.code && typeof body.code === 'string') {
      code = body.code.trim();
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Не указан код инвайта' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isValidInviteCode(code)) {
    return new Response(JSON.stringify({ error: 'Некорректный формат кода инвайта' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Fetch invite
  const invite = await deps.db.getInvite(code);
  if (!invite) {
    return new Response(
      JSON.stringify({ error: 'Ссылка-приглашение не найдена или была отозвана', code: 'INVITE_NOT_FOUND' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 3. Expiration check
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const expiresAtMs = new Date(invite.expires_at).getTime();
  if (expiresAtMs <= nowMs) {
    return new Response(
      JSON.stringify({
        error: 'Срок действия приглашения истек (действует 48 часов)',
        code: 'INVITE_EXPIRED',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 4. Max uses check
  if (invite.uses >= invite.max_uses) {
    return new Response(
      JSON.stringify({
        error: 'Ссылка-приглашение уже была использована (одноразовая)',
        code: 'INVITE_ALREADY_USED',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // 5. Consume invite and join
  const joinResult = await deps.db.joinPantryViaInvite(code, user.id);
  const pantries = await deps.db.getUserPantries(user.id);

  return new Response(
    JSON.stringify({
      pantry: joinResult.pantry,
      alreadyMember: joinResult.alreadyMember,
      pantries,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function handleLeavePantry(
  user: TelegramUser,
  pantryId: string,
  deps: ApiDependencies
): Promise<Response> {
  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Вы не состоите в этом складе', code: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (membership === 'owner') {
    return new Response(
      JSON.stringify({
        error: 'Владелец не может покинуть склад. Вы можете удалить его, если хотите закрыть склад.',
        code: 'OWNER_CANNOT_LEAVE',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  await deps.db.leavePantry(pantryId, user.id);
  const pantries = await deps.db.getUserPantries(user.id);

  return new Response(JSON.stringify({ success: true, pantries }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleDeletePantry(
  user: TelegramUser,
  pantryId: string,
  deps: ApiDependencies
): Promise<Response> {
  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (membership !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'Только владелец может удалить склад', code: 'ONLY_OWNER_CAN_DELETE' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  await deps.db.deletePantry(pantryId, user.id);
  const pantries = await deps.db.getUserPantries(user.id);

  return new Response(JSON.stringify({ success: true, pantries }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleRemoveMember(
  user: TelegramUser,
  pantryId: string,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (membership !== 'owner') {
    return new Response(
      JSON.stringify({ error: 'Только владелец может исключать участников', code: 'ONLY_OWNER_CAN_REMOVE' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let targetUserId = 0;
  try {
    const body = await req.json();
    targetUserId = Number(body?.user_id);
  } catch {
    // invalid body
  }

  if (!targetUserId || targetUserId === user.id) {
    return new Response(JSON.stringify({ error: 'Некорректный ID участника' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await deps.db.removePantryMember(pantryId, user.id, targetUserId);
  const members = await deps.db.getPantryMembers(pantryId);

  return new Response(JSON.stringify({ success: true, members }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleGetMembers(
  user: TelegramUser,
  pantryId: string,
  deps: ApiDependencies
): Promise<Response> {
  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(JSON.stringify({ error: 'Нет доступа к данному складу', code: 'FORBIDDEN' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const members = await deps.db.getPantryMembers(pantryId);
  return new Response(JSON.stringify({ members }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleUpdateWriteAccess(
  user: TelegramUser,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  let canWrite = false;
  try {
    const body = await req.json();
    canWrite = Boolean(body?.can_write_pm);
  } catch {
    // default false
  }

  await deps.db.updateCanWritePm(user.id, canWrite);
  return new Response(JSON.stringify({ success: true, can_write_pm: canWrite }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleTestReminder(
  user: TelegramUser,
  _req: Request,
  deps: ApiDependencies
): Promise<Response> {
  if (!deps.botToken) {
    return new Response(
      JSON.stringify({
        error: 'В настройках Supabase Edge Function не задан BOT_TOKEN. Укажите его в Supabase Secrets.',
        code: 'NO_BOT_TOKEN',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userRecord = await deps.db.getUser(user.id);
  const lang = (userRecord?.language_code || user.language_code || 'ru') as SupportedLanguage;
  const tz = userRecord?.timezone || 'Europe/Moscow';
  const now = deps.now ? deps.now() : new Date();
  const userLocalDate = getUserLocalDate(now, tz);

  const pantries = await deps.db.getUserPantries(user.id);
  const allExpiringSections: string[] = [];

  for (const pantry of pantries) {
    const items = await deps.db.getPantryItems(pantry.id, 'active');
    const reminderItems: ReminderItem[] = [];

    for (const item of items) {
      const daysRemaining = calculateDaysRemaining(item.expiration_date, userLocalDate);
      const stage = categorizeReminderStage(daysRemaining);
      if (stage) {
        reminderItems.push({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          expiration_date: item.expiration_date,
          stage,
          daysRemaining,
        });
      }
    }

    if (reminderItems.length > 0) {
      const formatted = formatPantryReminderHtml(pantry.name, reminderItems, lang);
      if (formatted) {
        allExpiringSections.push(formatted);
      }
    }
  }

  let textToSend = '';
  if (allExpiringSections.length > 0) {
    textToSend = allExpiringSections.join('\n\n');
  } else {
    textToSend = `🔔 <b>${t(lang, 'settings_title')}</b> (Тест)\n\n✓ Бот успешно подключен к вашему Telegram!\nНа ваших складах всё в порядке, просроченных или критических товаров нет.`;
  }

  try {
    const fetchFn = (deps as any).fetch || fetch;
    const tgRes = await fetchFn(`https://api.telegram.org/bot${deps.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.id,
        text: textToSend,
        parse_mode: 'HTML',
      }),
    });

    if (tgRes.status === 403) {
      await deps.db.updateCanWritePm(user.id, false);
      return new Response(
        JSON.stringify({
          error: t(lang, 'settings_bot_blocked_warn'),
          code: 'BOT_BLOCKED',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!tgRes.ok) {
      const errBody = await tgRes.text().catch(() => '');
      return new Response(
        JSON.stringify({
          error: `Telegram API error: ${errBody || tgRes.statusText}`,
          code: 'TELEGRAM_ERROR',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deps.db.updateCanWritePm(user.id, true);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Тестовое уведомление успешно отправлено в Telegram!',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: `Не удалось связаться с Telegram API: ${err?.message || 'ошибка сети'}`,
        code: 'NETWORK_ERROR',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
