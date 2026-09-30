import type {
  SendRemindersDependencies,
  SendRemindersResult,
} from './types.ts';
import {
  isUserReminderDue,
  getUserLocalDate,
  calculateDaysRemaining,
  categorizeReminderStage,
  formatPantryReminderHtml,
  type ReminderItem,
} from '../../../shared/reminders.ts';

export async function handleSendReminders(
  req: Request,
  deps: SendRemindersDependencies
): Promise<Response> {
  // 1. Authenticate cron trigger
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const cronSecretHeader = req.headers.get('x-cron-secret');
  const url = new URL(req.url);
  const secretQuery = url.searchParams.get('secret') || url.searchParams.get('cron_secret');

  let providedSecret = '';
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    providedSecret = authHeader.slice(7).trim();
  } else if (cronSecretHeader) {
    providedSecret = cronSecretHeader.trim();
  } else if (secretQuery) {
    providedSecret = secretQuery.trim();
  }

  if (!deps.cronSecret || providedSecret !== deps.cronSecret) {
    return new Response(
      JSON.stringify({
        error: 'Unauthorized: invalid or missing cron secret',
        code: 'CRON_UNAUTHORIZED',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const now = deps.now ? deps.now() : new Date();
  const fetchFn = deps.fetch || fetch;

  // 2. Fetch all users eligible for reminders (reminders_enabled = true && can_write_pm = true)
  const allEligibleUsers = await deps.db.getEligibleUsers();

  // 3. Filter users whose local hour matches reminder_hour right now
  const dueUsers = allEligibleUsers.filter((user) => isUserReminderDue(user, now));

  let messagesSent = 0;
  let loggedReminders = 0;

  for (const user of dueUsers) {
    const userLocalDate = getUserLocalDate(now, user.timezone);
    const pantries = await deps.db.getUserPantriesWithActiveItems(user.telegram_id);

    // Collect all active item candidate IDs to batch-query existing reminder logs
    const candidateItemIds: string[] = [];
    for (const pantry of pantries) {
      for (const item of pantry.items) {
        candidateItemIds.push(item.id);
      }
    }

    if (candidateItemIds.length === 0) {
      continue;
    }

    const existingLogs = await deps.db.getExistingReminderLogs(user.telegram_id, candidateItemIds);

    // Process each pantry
    let userBlockedBot = false;

    for (const pantry of pantries) {
      if (userBlockedBot) break;

      const itemsForPantry: ReminderItem[] = [];

      for (const item of pantry.items) {
        const daysRemaining = calculateDaysRemaining(item.expiration_date, userLocalDate);
        const stage = categorizeReminderStage(daysRemaining);
        if (!stage) continue;

        const logKey = `${item.id}:${stage}`;
        if (existingLogs.has(logKey)) {
          // Already reminded for this stage
          continue;
        }

        itemsForPantry.push({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          expiration_date: item.expiration_date,
          stage,
          daysRemaining,
        });
      }

      if (itemsForPantry.length === 0) {
        continue;
      }

      // Format Telegram HTML message
      const htmlText = formatPantryReminderHtml(
        pantry.pantryName,
        itemsForPantry,
        user.language_code,
        20
      );

      // Send to Telegram Bot API
      try {
        const tgRes = await fetchFn(`https://api.telegram.org/bot${deps.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegram_id,
            text: htmlText,
            parse_mode: 'HTML',
          }),
        });

        if (tgRes.status === 403) {
          // User blocked bot or deactivated chat
          userBlockedBot = true;
          await deps.db.updateCanWritePm(user.telegram_id, false);
          break;
        }

        if (tgRes.ok) {
          messagesSent++;
          const recordsToLog = itemsForPantry.map((item) => ({
            user_id: user.telegram_id,
            item_id: item.id,
            stage: item.stage,
          }));

          await deps.db.recordReminderLogs(recordsToLog);
          loggedReminders += recordsToLog.length;

          // Add to local cache so subsequent pantries in same user won't duplicate if shared
          for (const item of itemsForPantry) {
            existingLogs.add(`${item.id}:${item.stage}`);
          }
        } else {
          const errBody = await tgRes.text().catch(() => '');
          console.warn(`Telegram API error for user ${user.telegram_id}: status ${tgRes.status}, body: ${errBody}`);
        }
      } catch (sendErr) {
        console.error(`Failed to send reminder to user ${user.telegram_id}:`, sendErr);
      }
    }
  }

  const result: SendRemindersResult = {
    success: true,
    dueUsersCount: dueUsers.length,
    messagesSent,
    loggedReminders,
  };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
