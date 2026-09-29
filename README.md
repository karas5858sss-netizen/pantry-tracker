# 📦 Pantry Tracker — Telegram Mini App

Telegram Mini App для домашнего учёта продуктов и сроков годности.

---

## 🚀 Текущий статус: Этап 0 (Проверка камеры)

На данном этапе развёрнут базовый каркас проекта и тестовая страница проверки считывания штрихкодов перед разработкой бизнес-логики и базы данных.

### Что реализовано в этапе 0:
1. **Каркас проекта:** Vite + React + TypeScript + Tailwind CSS, чистая модульная структура (`src/`, `shared/`, `supabase/`, `tests/`).
2. **Сканер штрихкодов:** на базе `zxing-wasm` с локальной загрузкой бинарного модуля WebAssembly без сторонних CDN (критично для стабильности в РФ и Испании).
3. **Три режима работы:**
   - 📹 **Живая камера:** `getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` с флагами `playsinline` и `muted` (защита от чёрного экрана на iOS) + кнопка фонарика (torch).
   - 📷 **Запасной режим А (Снимок/Фото):** `<input type="file" accept="image/*" capture="environment">` с мгновенным декодированием кадра.
   - ⌨️ **Запасной режим Б (Ручной ввод):** ввод цифр штрихкода с расчётом и проверкой контрольной суммы EAN-13 / EAN-8 по стандарту GS1.
4. **Тесты:** 19 юнит-тестов Vitest для алгоритма контрольной суммы EAN, валидации ввода и очистки штрихкодов.
5. **CI:** GitHub Actions (`.github/workflows/ci.yml`), проверяющий `tsc --noEmit`, `vitest run` и `npm run build`.

---

## 📁 Структура репозитория

```
src/                       Фронтенд (React, Vite, Tailwind)
  ├── components/          Компоненты: LiveScanner, PhotoScanner, ManualBarcodeInput
  ├── barcodeReader.ts     Обёртка над zxing-wasm с локальным WASM
  ├── telegram.ts          Взаимодействие с Telegram WebApp SDK и тактильный отклик
  ├── index.css            Tailwind + переменные темы Telegram (--tg-theme-*)
  ├── App.tsx              Главный контейнер режимов и результатов
  └── main.tsx             Точка входа React
shared/                    Чистая логика без привязки к среде (работает в браузере, Node.js, Deno)
  └── ean.ts               GS1 расчёт и валидация контрольной суммы EAN-13/EAN-8
supabase/
  ├── migrations/          SQL-миграции (RLS без политик, таблицы)
  └── functions/           api/ и send-reminders/ (чистые handlers)
tests/                     Автотесты
  └── shared/ean.test.ts   Тесты контрольных сумм и валидации EAN
public/
  └── wasm/                Локальный zxing_reader.wasm (953 KB)
.github/workflows/ci.yml   CI пайплайн (check -> test -> build)
README.md, .env.example
```

---

## 🛠️ Локальный запуск и разработка

### Требования
- Node.js 20+ (рекомендуется Node.js 22 LTS)
- npm 10+

### Установка зависимостей
```bash
npm ci
```

### Запуск тестов
```bash
npm test
```
Запуск тестов в режиме наблюдения (watch):
```bash
npm run test:watch
```

### Проверка типов
```bash
npm run check
```

### Локальный dev-сервер
```bash
npm run dev
```
Сервер запустится по адресу `http://localhost:5173`.

### Сборка production-бандла
```bash
npm run build
```
Результат сборки помещается в директорию `dist/`.

---

## 🌐 Как задеплоить на Cloudflare Pages

### Вариант 1: Автоматический деплой через Git (Рекомендуется)

1. Зайдите в [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Выберите ваш репозиторий `pantry-tracker`.
3. Укажите параметры сборки:
   - **Framework preset:** `Vite` (или `None`)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node.js Version:** `22` (в Environment variables добавьте `NODE_VERSION` = `22`)
4. Нажмите **Save and Deploy**.
5. Через 1–2 минуты Cloudflare выдаст уникальный URL: `https://<project-name>.pages.dev`.

### Вариант 2: Деплой через Wrangler CLI
```bash
npx wrangler pages deploy dist --project-name pantry-tracker
```

---

## 🤖 Подключение как Mini App в Telegram

1. Откройте диалог с [@BotFather](https://t.me/BotFather) в Telegram.
2. Введите команду `/newapp`.
3. Выберите вашего бота (созданного на этапе P).
4. Введите название приложения: `Pantry Tracker`.
5. Введите краткое описание: `Учёт продуктов и сроков годности`.
6. Загрузите иконку (640x360 px или пропустите `/empty`).
7. На шаге **Web App URL** укажите адрес, выданный Cloudflare Pages:
   ```
   https://<project-name>.pages.dev
   ```
8. Введите short name для ссылки (например, `app`):
   Ваша ссылка будет: `https://t.me/<BOT_USERNAME>/app`.

---

## 📱 Чек-лист приёмки Этапа 0 (проверка на устройствах)

Откройте ссылку `https://t.me/<BOT_USERNAME>/app` внутри Telegram на **реальном iPhone (iOS)** и **реальном Android**:

1. [ ] **Запрос разрешений:**
   - На iOS при первом запуске всплывает системный запрос доступа к камере.
   - На Android доступ запрашивается корректно.
2. [ ] **Отсутствие чёрного экрана на iOS:**
   - Видеопоток сразу отображается в видоискателе (благодаря `playsinline` и `muted`).
3. [ ] **Скорость распознавания EAN-13:**
   - Наведите камеру на любой магазинный товар с штрихкодом EAN-13.
   - Сканер считывает код за долю секунды, срабатывает вибрация (haptic) и выводится статус `EAN OK` и `Контрольная сумма верна`.
4. [ ] **Запасной режим фото (кнопка «Фото»):**
   - Нажмите «Снять фото», сфотографируйте штрихкод.
   - Убедитесь, что кадр декодируется без использования живого видео.
5. [ ] **Запасной режим ввода вручную (кнопка «Вручную»):**
   - Введите 12 цифр — приложение подскажет правильную 13-ю контрольную цифру.
   - При намеренной ошибке в последней цифре отображается ошибка контрольной суммы.
6. [ ] **Тема Telegram:**
   - Переключите тему Telegram (светлая/тёмная) — цвета интерфейса адаптируются автоматически без перезагрузки.

---

## 🔒 Переменные окружения

Для этапа 0 переменные окружения не требуются.
На этапе 1 будут добавлены:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_TELEGRAM_BOT_NAME`

Секреты (`BOT_TOKEN`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) **никогда** не хранятся на клиенте и не коммитятся в git.
