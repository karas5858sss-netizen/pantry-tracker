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
  InviteRecord,
  PantryMemberRecord,
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

  async getUserPantryMembership(pantryId: string, userId: number): Promise<'owner' | 'member' | null> {
    const { data, error } = await supabase
      .from('pantry_members')
      .select('role')
      .eq('pantry_id', pantryId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data.role as 'owner' | 'member';
  },

  async getPantryMembers(pantryId: string): Promise<PantryMemberRecord[]> {
    const { data, error } = await supabase
      .from('pantry_members')
      .select('pantry_id, user_id, role, joined_at, users(first_name, username)')
      .eq('pantry_id', pantryId);

    if (error || !data) return [];

    return data.map((row: any) => ({
      pantry_id: row.pantry_id,
      user_id: row.user_id,
      role: row.role,
      first_name: row.users?.first_name || 'Пользователь',
      username: row.users?.username || null,
      joined_at: row.joined_at,
    }));
  },

  async createPantryInvite(
    pantryId: string,
    createdBy: number,
    code: string,
    expiresAt: string,
    maxUses: number
  ): Promise<InviteRecord> {
    const { data, error } = await supabase
      .from('pantry_invites')
      .insert({
        pantry_id: pantryId,
        created_by: createdBy,
        code,
        expires_at: expiresAt,
        max_uses: maxUses,
        uses: 0,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create invite: ${error?.message}`);
    }
    return data as InviteRecord;
  },

  async getInvite(code: string): Promise<InviteRecord | null> {
    const { data, error } = await supabase
      .from('pantry_invites')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error || !data) return null;
    return data as InviteRecord;
  },

  async joinPantryViaInvite(
    code: string,
    userId: number
  ): Promise<{ pantry: PantryRecord; alreadyMember: boolean }> {
    const invite = await this.getInvite(code);
    if (!invite) {
      throw new Error('Invite not found');
    }

    const { data: pantry, error: pantryErr } = await supabase
      .from('pantries')
      .select('id, name, created_at')
      .eq('id', invite.pantry_id)
      .single();

    if (pantryErr || !pantry) {
      throw new Error('Pantry not found');
    }

    const existingMembership = await this.getUserPantryMembership(invite.pantry_id, userId);
    if (existingMembership) {
      return {
        pantry: {
          id: pantry.id,
          name: pantry.name,
          role: existingMembership,
          created_at: pantry.created_at,
        },
        alreadyMember: true,
      };
    }

    // Insert membership
    const { error: memberErr } = await supabase.from('pantry_members').insert({
      pantry_id: invite.pantry_id,
      user_id: userId,
      role: 'member',
    });

    if (memberErr) {
      throw new Error(`Failed to add pantry member: ${memberErr.message}`);
    }

    // Increment uses
    await supabase
      .from('pantry_invites')
      .update({ uses: invite.uses + 1 })
      .eq('code', code);

    return {
      pantry: {
        id: pantry.id,
        name: pantry.name,
        role: 'member',
        created_at: pantry.created_at,
      },
      alreadyMember: false,
    };
  },

  async leavePantry(pantryId: string, userId: number): Promise<void> {
    const { error } = await supabase
      .from('pantry_members')
      .delete()
      .eq('pantry_id', pantryId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to leave pantry: ${error.message}`);
    }
  },

  async deletePantry(pantryId: string, _ownerId: number): Promise<void> {
    const { error } = await supabase.from('pantries').delete().eq('id', pantryId);
    if (error) {
      throw new Error(`Failed to delete pantry: ${error.message}`);
    }
  },

  async removePantryMember(pantryId: string, _ownerId: number, targetUserId: number): Promise<void> {
    const { error } = await supabase
      .from('pantry_members')
      .delete()
      .eq('pantry_id', pantryId)
      .eq('user_id', targetUserId);

    if (error) {
      throw new Error(`Failed to remove member: ${error.message}`);
    }
  },

  async updateCanWritePm(userId: number, canWrite: boolean): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ can_write_pm: canWrite })
      .eq('telegram_id', userId);

    if (error) {
      console.warn('Failed to update can_write_pm:', error);
    }
  },
};

const deps: ApiDependencies = {
  db,
  botToken: BOT_TOKEN,
  botUsername: 'sklad_jli_bot',
  appShortName: 'app',
};

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  return handleApiRequest(req, deps);
});
