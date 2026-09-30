/**
 * Pure handlers for pantry items and expiration dates.
 */

import type { ApiDependencies, ItemRecord, CreateItemData } from './types.ts';
import type { TelegramUser } from '../../../shared/telegramAuth.ts';
import { validateExpirationDate } from '../../../shared/expiration.ts';
import { selectFifoItem } from '../../../shared/inventory.ts';

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

export async function handleConsumeItem(
  user: TelegramUser,
  pantryId: string,
  itemId: string,
  req: Request,
  deps: ApiDependencies,
  action: 'consumed' | 'discarded' = 'consumed'
): Promise<Response> {
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(
      JSON.stringify({ error: 'Доступ запрещен', code: 'NOT_ALLOWED' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(
      JSON.stringify({ error: 'У вас нет доступа к этому складу', code: 'FORBIDDEN' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const item = await deps.db.getItem(itemId);
  if (!item || item.pantry_id !== pantryId) {
    return new Response(
      JSON.stringify({ error: 'Товар не найден на складе' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (item.status !== 'active') {
    return new Response(
      JSON.stringify({ error: 'Товар уже списан' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const consumeAll = Boolean(body?.all);

  const previousState = {
    id: item.id,
    quantity: item.quantity,
    status: item.status,
    closed_at: item.closed_at,
  };

  let updated: ItemRecord;
  const now = deps.now ? deps.now() : new Date();

  if (item.quantity > 1 && !consumeAll) {
    // Decrement quantity by 1
    updated = await deps.db.updateItem(item.id, {
      quantity: item.quantity - 1,
    });
  } else {
    // Close item
    updated = await deps.db.updateItem(item.id, {
      status: action,
      closed_at: now.toISOString(),
    });
  }

  return new Response(
    JSON.stringify({
      item: updated,
      previousState,
      action,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handleRestoreItem(
  user: TelegramUser,
  pantryId: string,
  itemId: string,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(
      JSON.stringify({ error: 'Доступ запрещен', code: 'NOT_ALLOWED' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(
      JSON.stringify({ error: 'У вас нет доступа к этому складу', code: 'FORBIDDEN' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const item = await deps.db.getItem(itemId);
  if (!item || item.pantry_id !== pantryId) {
    return new Response(
      JSON.stringify({ error: 'Товар не найден на складе' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json().catch(() => null);
  const previousQuantity = typeof body?.quantity === 'number' && body.quantity > 0 ? body.quantity : item.quantity + 1;
  const previousStatus = body?.status === 'consumed' || body?.status === 'discarded' ? body.status : 'active';
  const previousClosedAt = body?.closed_at !== undefined ? body.closed_at : null;

  const restored = await deps.db.updateItem(item.id, {
    quantity: previousQuantity,
    status: previousStatus,
    closed_at: previousClosedAt,
  });

  return new Response(
    JSON.stringify({ item: restored }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handleConsumeBarcodeFifo(
  user: TelegramUser,
  pantryId: string,
  req: Request,
  deps: ApiDependencies
): Promise<Response> {
  const isAllowed = await deps.db.isUserAllowed(user.id);
  if (!isAllowed) {
    return new Response(
      JSON.stringify({ error: 'Доступ запрещен', code: 'NOT_ALLOWED' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const membership = await deps.db.getUserPantryMembership(pantryId, user.id);
  if (!membership) {
    return new Response(
      JSON.stringify({ error: 'У вас нет доступа к этому складу', code: 'FORBIDDEN' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.json().catch(() => null);
  const barcode = typeof body?.barcode === 'string' ? body.barcode.trim() : '';
  const itemId = typeof body?.itemId === 'string' ? body.itemId.trim() : '';
  const action: 'consumed' | 'discarded' = body?.action === 'discarded' ? 'discarded' : 'consumed';
  const force = Boolean(body?.force);

  if (!barcode && !itemId) {
    return new Response(
      JSON.stringify({ error: 'Укажите штрихкод или ID товара' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // If specific itemId was selected
  if (itemId) {
    const item = await deps.db.getItem(itemId);
    if (!item || item.pantry_id !== pantryId || item.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Выбранный товар не найден или уже списан' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const previousState = {
      id: item.id,
      quantity: item.quantity,
      status: item.status,
      closed_at: item.closed_at,
    };

    const now = deps.now ? deps.now() : new Date();
    let updated: ItemRecord;
    if (item.quantity > 1 && !body?.all) {
      updated = await deps.db.updateItem(item.id, { quantity: item.quantity - 1 });
    } else {
      updated = await deps.db.updateItem(item.id, { status: action, closed_at: now.toISOString() });
    }

    return new Response(
      JSON.stringify({
        found: true,
        multipleBatches: false,
        item: updated,
        previousState,
        action,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Otherwise, find active items by barcode
  const activeItems = await deps.db.getActiveItemsByBarcode(pantryId, barcode);
  if (activeItems.length === 0) {
    return new Response(
      JSON.stringify({ found: false, items: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const fifoRes = selectFifoItem(activeItems, barcode);
  if (!fifoRes) {
    return new Response(
      JSON.stringify({ found: false, items: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // If multiple batches with different expiration dates exist and not forced:
  if (fifoRes.hasMultipleBatches && !force) {
    return new Response(
      JSON.stringify({
        found: true,
        multipleBatches: true,
        items: fifoRes.matchingItems,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Execute FIFO consumption on the earliest item
  const earliest = fifoRes.earliestItem;
  const previousState = {
    id: earliest.id,
    quantity: earliest.quantity,
    status: earliest.status,
    closed_at: earliest.closed_at,
  };

  const now = deps.now ? deps.now() : new Date();
  let updated: ItemRecord;
  if (earliest.quantity > 1 && !body?.all) {
    updated = await deps.db.updateItem(earliest.id, { quantity: earliest.quantity - 1 });
  } else {
    updated = await deps.db.updateItem(earliest.id, { status: action, closed_at: now.toISOString() });
  }

  return new Response(
    JSON.stringify({
      found: true,
      multipleBatches: false,
      item: updated,
      previousState,
      action,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

