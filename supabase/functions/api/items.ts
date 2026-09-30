/**
 * Pure handlers for pantry items and expiration dates.
 */

import type { ApiDependencies, ItemRecord, CreateItemData } from './types.ts';
import type { TelegramUser } from '../../../shared/telegramAuth.ts';
import { validateExpirationDate } from '../../../shared/expiration.ts';

export async function handleCreateItem(
  user: TelegramUser,
  pantryId: string,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(
      JSON.stringify({
        error: 'Доступ запрещен: ваш Telegram ID не в списке разрешенных.',
        code: 'NOT_ALLOWED',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Verify membership in pantry
  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(
      JSON.stringify({
        error: 'У вас нет доступа к этому складу (вы не являетесь участником).',
        code: 'FORBIDDEN',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return new Response(
      JSON.stringify({ error: 'Некорректное тело запроса' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const expirationDate = typeof body.expiration_date === 'string' ? body.expiration_date.trim() : '';
  const barcode = typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null;
  const quantity = typeof body.quantity === 'number' && Number.isInteger(body.quantity) && body.quantity > 0 ? body.quantity : 1;

  if (!name) {
    return new Response(
      JSON.stringify({ error: 'Название товара не может быть пустым' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const now = deps.now ? deps.now() : new Date();
  const dateValidation = validateExpirationDate(expirationDate, now);
  if (!dateValidation.isValid) {
    return new Response(
      JSON.stringify({ error: dateValidation.error || 'Неверный срок годности' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const createData: CreateItemData = {
    pantry_id: pantryId,
    barcode,
    name,
    expiration_date: expirationDate,
    quantity,
    created_by: user.id,
  };

  const item: ItemRecord = await deps.db.createItem(createData);

  // If a barcode was provided, also save product to catalog
  if (barcode) {
    try {
      await deps.db.upsertProduct(barcode, name, 'manual');
    } catch (err) {
      console.warn(`[Auto-catalog sync warning for ${barcode}]:`, err);
    }
  }

  return new Response(
    JSON.stringify({ item }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handleGetPantryItems(
  user: TelegramUser,
  pantryId: string,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(
      JSON.stringify({
        error: 'Доступ запрещен: ваш Telegram ID не в списке разрешенных.',
        code: 'NOT_ALLOWED',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(
      JSON.stringify({
        error: 'У вас нет доступа к этому складу (вы не являетесь участником).',
        code: 'FORBIDDEN',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'consumed' || statusParam === 'discarded' ? statusParam : 'active';

  const items = await deps.db.getPantryItems(pantryId, status);

  return new Response(
    JSON.stringify({ items }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
