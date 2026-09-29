/**
 * Pure handlers for product resolution and manual/OFF catalog updates.
 */

import type { ApiDependencies, ProductRecord } from './types.ts';
import type { TelegramUser } from '../../../shared/telegramAuth.ts';

export async function handleGetProduct(
  user: TelegramUser,
  barcode: string,
  lang: 'ru' | 'es' | 'en',
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

  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) {
    return new Response(
      JSON.stringify({ error: 'Не указан штрихкод' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 1. Priority 1: Check internal database
  const localProduct = await deps.db.getProduct(cleanBarcode);
  if (localProduct) {
    return new Response(
      JSON.stringify({
        found: true,
        product: localProduct,
        source: localProduct.source,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Priority 2: Check Open Food Facts via dependency injection
  if (deps.fetchOffProduct) {
    try {
      const offName = await deps.fetchOffProduct(cleanBarcode, lang);
      if (offName && offName.trim().length > 0) {
        const saved = await deps.db.upsertProduct(cleanBarcode, offName.trim(), 'off');
        return new Response(
          JSON.stringify({
            found: true,
            product: saved,
            source: 'off',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } catch (err) {
      console.warn(`[OFF Lookup Error] barcode ${cleanBarcode}:`, err);
    }
  }

  // 3. Priority 3: Not found -> client falls back to manual entry
  return new Response(
    JSON.stringify({
      found: false,
      product: null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

export async function handleUpsertProduct(
  user: TelegramUser,
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return new Response(
      JSON.stringify({ error: 'Некорректное тело запроса' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const barcode = typeof body.barcode === 'string' ? body.barcode.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const source: 'manual' | 'off' = body.source === 'off' ? 'off' : 'manual';

  if (!barcode) {
    return new Response(
      JSON.stringify({ error: 'Не указан штрихкод' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!name) {
    return new Response(
      JSON.stringify({ error: 'Название товара не может быть пустым' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const saved: ProductRecord = await deps.db.upsertProduct(barcode, name, source);

  return new Response(
    JSON.stringify({
      product: saved,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
