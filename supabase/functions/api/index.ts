/**
 * Supabase Edge Function: api
 * Entry point that binds Deno runtime dependencies to the pure handler.
 */

// @ts-expect-error Deno import
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleApiRequest } from './handler.ts';
import type {
  ApiDependencies,
  DatabaseClient,
  UpsertUserData,
  UserRecord,
  PantryRecord,
} from './types.ts';

// @ts-expect-error Deno global
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// @ts-expect-error Deno global
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// @ts-expect-error Deno global
const BOT_TOKEN = Deno.env.get('BOT_TOKEN') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const db: DatabaseClient = {
  async isUserAllowed(telegramId: number): Promise<boolean> {
    const { data, error } = await supabase
      .from('allowed_users')
      .select('telegram_id')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error) {
      console.error('Error checking allowed_users:', error);
      return false;
    }
    return !!data;
  },

  async getUsersCount(): Promise<number> {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error counting users:', error);
      return 0;
    }
    return count ?? 0;
  },

  async getUser(telegramId: number): Promise<UserRecord | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error || !data) return null;
    return data as UserRecord;
  },

  async upsertUser(userData: UpsertUserData): Promise<UserRecord> {
    const { data, error } = await supabase
      .from('users')
      .upsert(
        {
          telegram_id: userData.telegram_id,
          first_name: userData.first_name,
          username: userData.username,
          language_code: userData.language_code,
          timezone: userData.timezone,
        },
        { onConflict: 'telegram_id' }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to upsert user: ${error?.message}`);
    }
    return data as UserRecord;
  },

  async getUserPantries(telegramId: number): Promise<PantryRecord[]> {
    const { data, error } = await supabase
      .from('pantry_members')
      .select('role, pantries(id, name, created_at)')
      .eq('user_id', telegramId);

    if (error || !data) return [];

    return data
      .filter((row: any) => row.pantries)
      .map((row: any) => ({
        id: row.pantries.id,
        name: row.pantries.name,
        role: row.role as 'owner' | 'member',
        created_at: row.pantries.created_at,
      }));
  },

  async createPantry(name: string, ownerTelegramId: number): Promise<PantryRecord> {
    const { data: pantry, error: pantryErr } = await supabase
      .from('pantries')
      .insert({ name })
      .select()
      .single();

    if (pantryErr || !pantry) {
      throw new Error(`Failed to create pantry: ${pantryErr?.message}`);
    }

    const { error: memberErr } = await supabase.from('pantry_members').insert({
      pantry_id: pantry.id,
      user_id: ownerTelegramId,
      role: 'owner',
    });

    if (memberErr) {
      throw new Error(`Failed to attach owner to pantry: ${memberErr.message}`);
    }

    return {
      id: pantry.id,
      name: pantry.name,
      role: 'owner',
      created_at: pantry.created_at,
    };
  },
};

const deps: ApiDependencies = {
  db,
  botToken: BOT_TOKEN,
};

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  return handleApiRequest(req, deps);
});
