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

  let item: ItemRecord;
  let isMerged = false;

  if (deps.db.mergeOrCreateItem) {
    const res = await deps.db.mergeOrCreateItem(createData);
    item = res.item;
    isMerged = res.merged;
  } else {
    // Fallback for mockDb / environments without RPC
    const existingItem = await deps.db.findActiveItem(pantryId, expirationDate, barcode, name);
    if (existingItem) {
      item = await deps.db.updateItem(existingItem.id, {
        quantity: existingItem.quantity + quantity,
      });
      isMerged = true;
    } else {
      item = await deps.db.createItem(createData);
      isMerged = false;
    }
  }

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
    { status: isMerged ? 200 : 201, headers: { 'Content-Type': 'application/json' } }
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

  // Use atomic row-level lock procedure if available
  if (deps.db.consumePantryItemAtomic) {
    const atomicRes = await deps.db.consumePantryItemAtomic(itemId, action, consumeAll);
    if (atomicRes) {
      return new Response(
        JSON.stringify({
          item: atomicRes.item,
          previousState: atomicRes.previousState,
          action,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

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

  const now = deps.now ? deps.now() : new Date();

  // Enforce Undo window protection (5s UI banner + grace period for network latency)
  if (item.closed_at) {
    const elapsedMs = now.getTime() - new Date(item.closed_at).getTime();
    if (elapsedMs > 15000) {
      return new Response(
        JSON.stringify({
          error: 'Время отмены действия (Undo) истекло (доступно только сразу после списания).',
          code: 'UNDO_EXPIRED',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  const body = await req.json().catch(() => null);
  // Restore safely: either re-open closed item with its original quantity, or increment decremented quantity by 1
  const restoredQuantity = typeof body?.quantity === 'number' && body.quantity > 0 
    ? Math.min(body.quantity, item.quantity + 1)
    : item.quantity + 1;

  const restored = await deps.db.updateItem(item.id, {
    quantity: restoredQuantity,
    status: 'active',
    closed_at: null,
  });

  return new Response(
    JSON.stringify({ item: restored }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handleUpdateItemQuantity(
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

  const body = await req.json().catch(() => ({}));
  const rawQuantity = body?.quantity;
  const quantity = typeof rawQuantity === 'number' ? Math.floor(rawQuantity) : parseInt(String(rawQuantity), 10);

  if (isNaN(quantity) || quantity < 0) {
    return new Response(
      JSON.stringify({ error: 'Количество должно быть неотрицательным целым числом' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
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

  if (quantity === 0) {
    updated = await deps.db.updateItem(item.id, {
      status: 'consumed',
      closed_at: now.toISOString(),
    });
  } else {
    updated = await deps.db.updateItem(item.id, {
      quantity,
      status: 'active',
      closed_at: null,
    });
  }

  return new Response(
    JSON.stringify({
      item: updated,
      previousState,
    }),
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

export async function handleClearPantryItems(
  user: TelegramUser,
  pantryId: string,
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

  await deps.db.clearActivePantryItems(pantryId);

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}


