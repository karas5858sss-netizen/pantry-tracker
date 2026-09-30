import { describe, it, expect, beforeEach } from 'vitest';
import { handleApiRequest } from '../../supabase/functions/api/handler.ts';
import { createTestInitData, type TelegramUser } from '../../shared/telegramAuth.ts';
import type {
  DatabaseClient,
  ApiDependencies,
  UserRecord,
  PantryRecord,
  PantryMemberRecord,
  InviteRecord,
  UpsertUserData,
  CreateItemData,
  ItemRecord,
  UpdateItemData,
} from '../../supabase/functions/api/types.ts';

const TEST_BOT_TOKEN = '123456789:ABCDEF_mock_bot_token_for_tests';

function createMockDb(): DatabaseClient & {
  allowedUsersSet: Set<number>;
  usersMap: Map<number, UserRecord>;
  pantriesMap: Map<string, { id: string; name: string; created_at: string }>;
  membersList: Array<{ pantry_id: string; user_id: number; role: 'owner' | 'member'; joined_at: string }>;
  invitesMap: Map<string, InviteRecord>;
} {
  const allowedUsersSet = new Set<number>();
  const usersMap = new Map<number, UserRecord>();
  const pantriesMap = new Map<string, { id: string; name: string; created_at: string }>();
  const membersList: Array<{ pantry_id: string; user_id: number; role: 'owner' | 'member'; joined_at: string }> = [];
  const invitesMap = new Map<string, InviteRecord>();

  return {
    allowedUsersSet,
    usersMap,
    pantriesMap,
    membersList,
    invitesMap,

    async isUserAllowed(telegramId: number): Promise<boolean> {
      return allowedUsersSet.has(telegramId);
    },

    async getUsersCount(): Promise<number> {
      return usersMap.size;
    },

    async getUser(telegramId: number): Promise<UserRecord | null> {
      return usersMap.get(telegramId) || null;
    },

    async upsertUser(userData: UpsertUserData): Promise<UserRecord> {
      const existing = usersMap.get(userData.telegram_id);
      const updated: UserRecord = {
        telegram_id: userData.telegram_id,
        first_name: userData.first_name,
        username: userData.username ?? null,
        language_code: userData.language_code ?? 'ru',
        timezone: userData.timezone ?? 'Europe/Moscow',
        reminder_hour: existing?.reminder_hour ?? 9,
        reminders_enabled: existing?.reminders_enabled ?? true,
        can_write_pm: existing?.can_write_pm ?? false,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      usersMap.set(userData.telegram_id, updated);
      return updated;
    },

    async getUserPantries(telegramId: number): Promise<PantryRecord[]> {
      const userMemberships = membersList.filter((m) => m.user_id === telegramId);
      const results: PantryRecord[] = [];

      for (const m of userMemberships) {
        const pantry = pantriesMap.get(m.pantry_id);
        if (pantry) {
          results.push({
            id: pantry.id,
            name: pantry.name,
            role: m.role,
            created_at: pantry.created_at,
          });
        }
      }
      return results;
    },

    async createPantry(name: string, ownerTelegramId: number): Promise<PantryRecord> {
      const id = `pantry-${pantriesMap.size + 1}`;
      const created_at = new Date().toISOString();
      pantriesMap.set(id, { id, name, created_at });
      membersList.push({ pantry_id: id, user_id: ownerTelegramId, role: 'owner', joined_at: created_at });

      return {
        id,
        name,
        role: 'owner',
        created_at,
      };
    },

    async getUserPantryMembership(pantryId: string, userId: number): Promise<'owner' | 'member' | null> {
      const entry = membersList.find((m) => m.pantry_id === pantryId && m.user_id === userId);
      return entry ? entry.role : null;
    },

    async getPantryMembers(pantryId: string): Promise<PantryMemberRecord[]> {
      return membersList
        .filter((m) => m.pantry_id === pantryId)
        .map((m) => {
          const user = usersMap.get(m.user_id);
          return {
            pantry_id: m.pantry_id,
            user_id: m.user_id,
            role: m.role,
            first_name: user?.first_name || `User ${m.user_id}`,
            username: user?.username || null,
            joined_at: m.joined_at,
          };
        });
    },

    async createPantryInvite(
      pantryId: string,
      createdBy: number,
      code: string,
      expiresAt: string,
      maxUses: number
    ): Promise<InviteRecord> {
      const rec: InviteRecord = {
        code,
        pantry_id: pantryId,
        created_by: createdBy,
        expires_at: expiresAt,
        max_uses: maxUses,
        uses: 0,
      };
      invitesMap.set(code, rec);
      return rec;
    },

    async getInvite(code: string): Promise<InviteRecord | null> {
      return invitesMap.get(code) || null;
    },

    async joinPantryViaInvite(
      code: string,
      userId: number
    ): Promise<{ pantry: PantryRecord; alreadyMember: boolean }> {
      const invite = invitesMap.get(code);
      if (!invite) throw new Error('Invite not found');

      const pantry = pantriesMap.get(invite.pantry_id);
      if (!pantry) throw new Error('Pantry not found');

      const existing = membersList.find((m) => m.pantry_id === invite.pantry_id && m.user_id === userId);
      if (existing) {
        return {
          pantry: {
            id: pantry.id,
            name: pantry.name,
            role: existing.role,
            created_at: pantry.created_at,
          },
          alreadyMember: true,
        };
      }

      membersList.push({
        pantry_id: invite.pantry_id,
        user_id: userId,
        role: 'member',
        joined_at: new Date().toISOString(),
      });
      invite.uses += 1;

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
      const idx = membersList.findIndex((m) => m.pantry_id === pantryId && m.user_id === userId);
      if (idx !== -1) {
        membersList.splice(idx, 1);
      }
    },

    async deletePantry(pantryId: string, _ownerId: number): Promise<void> {
      pantriesMap.delete(pantryId);
      for (let i = membersList.length - 1; i >= 0; i--) {
        if (membersList[i].pantry_id === pantryId) {
          membersList.splice(i, 1);
        }
      }
    },

    async removePantryMember(pantryId: string, _ownerId: number, targetUserId: number): Promise<void> {
      const idx = membersList.findIndex((m) => m.pantry_id === pantryId && m.user_id === targetUserId);
      if (idx !== -1) {
        membersList.splice(idx, 1);
      }
    },

    async updateCanWritePm(userId: number, canWrite: boolean): Promise<void> {
      const user = usersMap.get(userId);
      if (user) {
        user.can_write_pm = canWrite;
      }
    },

    async getProduct(_barcode: string) {
      return null;
    },
    async upsertProduct(barcode: string, name: string, source: 'manual' | 'off') {
      return { barcode, name, source, updated_at: new Date().toISOString() };
    },
    async createItem(_item: CreateItemData): Promise<ItemRecord> {
      throw new Error('Not implemented in invite tests');
    },
    async getPantryItems(_pantryId: string, _status?: 'active' | 'consumed' | 'discarded'): Promise<ItemRecord[]> {
      return [];
    },
    async getItem(_itemId: string): Promise<ItemRecord | null> {
      return null;
    },
    async updateItem(_itemId: string, _updates: UpdateItemData): Promise<ItemRecord> {
      throw new Error('Not implemented in invite tests');
    },
    async getActiveItemsByBarcode(_pantryId: string, _barcode: string): Promise<ItemRecord[]> {
      return [];
    },
    async findActiveItem(_pantryId: string, _exp: string, _bc?: string | null, _name?: string): Promise<ItemRecord | null> {
      return null;
    },
    async deleteItems(_itemIds: string[]): Promise<void> {},
    async clearActivePantryItems(_pantryId: string): Promise<void> {},
  };
}

describe('Stage 2: Pantries, Sharing & Invites API', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let deps: ApiDependencies;
  const fixedNow = new Date('2026-09-29T12:00:00Z');

  const userA: TelegramUser = { id: 1001, first_name: 'Alice' };
  const userB: TelegramUser = { id: 1002, first_name: 'Bob' };
  const userC: TelegramUser = { id: 1003, first_name: 'Charlie' };

  beforeEach(async () => {
    mockDb = createMockDb();
    deps = {
      db: mockDb,
      botToken: TEST_BOT_TOKEN,
      now: () => fixedNow,
      botUsername: 'sklad_jli_bot',
      appShortName: 'app',
    };

    // Alice and Bob are allowed
    mockDb.allowedUsersSet.add(1001);
    mockDb.allowedUsersSet.add(1002);

    await mockDb.upsertUser({ telegram_id: 1001, first_name: 'Alice' });
    await mockDb.upsertUser({ telegram_id: 1002, first_name: 'Bob' });
  });

  async function makeAuthRequest(
    user: TelegramUser,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Response> {
    const raw = await createTestInitData(user, TEST_BOT_TOKEN, {
      authDateSeconds: Math.floor(fixedNow.getTime() / 1000) - 10,
    });

    return handleApiRequest(
      new Request(`https://example.com/api${path}`, {
        method,
        headers: {
          Authorization: `tma ${raw}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      deps
    );
  }

  it('allows owner to create an invite link with 48h expiration and 1 use', async () => {
    const pantry = await mockDb.createPantry('Alice Pantry', 1001);

    const res = await makeAuthRequest(userA, 'POST', `/pantries/${pantry.id}/invites`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.code).toBeDefined();
    expect(data.code.length).toBeGreaterThanOrEqual(16);
    expect(data.maxUses).toBe(1);
    expect(data.inviteUrl).toContain(`https://t.me/sklad_jli_bot/app?startapp=join_${data.code}`);

    const expiresMs = new Date(data.expiresAt).getTime();
    expect(expiresMs - fixedNow.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('rejects invite creation by user who is not a member of the pantry with 403', async () => {
    const pantry = await mockDb.createPantry('Alice Pantry', 1001);

    // Bob tries to create invite for Alice's pantry
    const res = await makeAuthRequest(userB, 'POST', `/pantries/${pantry.id}/invites`);
    expect(res.status).toBe(403);
  });

  it('allows second user to join pantry via valid invite code', async () => {
    const pantry = await mockDb.createPantry('Shared Pantry', 1001);
    const inviteRes = await makeAuthRequest(userA, 'POST', `/pantries/${pantry.id}/invites`);
    const { code } = await inviteRes.json();

    // Bob joins with code
    const joinRes = await makeAuthRequest(userB, 'POST', '/invites/join', { code });
    expect(joinRes.status).toBe(200);

    const joinData = await joinRes.json();
    expect(joinData.pantry.id).toBe(pantry.id);
    expect(joinData.pantry.role).toBe('member');
    expect(joinData.alreadyMember).toBe(false);

    // Both Alice and Bob are members
    const members = await mockDb.getPantryMembers(pantry.id);
    expect(members.length).toBe(2);
    expect(members.find((m) => m.user_id === 1002)?.role).toBe('member');
  });

  it('rejects invite if user is not in whitelist (allowed_users)', async () => {
    const pantry = await mockDb.createPantry('Shared Pantry', 1001);
    const inviteRes = await makeAuthRequest(userA, 'POST', `/pantries/${pantry.id}/invites`);
    const { code } = await inviteRes.json();

    // Charlie is NOT in allowedUsersSet
    const joinRes = await makeAuthRequest(userC, 'POST', '/invites/join', { code });
    expect(joinRes.status).toBe(403);
    const body = await joinRes.json();
    expect(body.code).toBe('NOT_ALLOWED');
  });

  it('rejects expired invite code with 400 INVITE_EXPIRED', async () => {
    const pantry = await mockDb.createPantry('Old Pantry', 1001);
    // Expired 1 hour ago
    const expiredAt = new Date(fixedNow.getTime() - 3600 * 1000).toISOString();
    await mockDb.createPantryInvite(pantry.id, 1001, 'expired_invite_code_123', expiredAt, 1);

    const joinRes = await makeAuthRequest(userB, 'POST', '/invites/join', {
      code: 'expired_invite_code_123',
    });
    expect(joinRes.status).toBe(400);
    const body = await joinRes.json();
    expect(body.code).toBe('INVITE_EXPIRED');
  });

  it('enforces single use (max_uses) on invite and rejects reused link', async () => {
    const pantry = await mockDb.createPantry('One Time Pantry', 1001);
    const inviteRes = await makeAuthRequest(userA, 'POST', `/pantries/${pantry.id}/invites`);
    const { code } = await inviteRes.json();

    // 1st use by Bob -> succeeds
    const joinBob = await makeAuthRequest(userB, 'POST', '/invites/join', { code });
    expect(joinBob.status).toBe(200);

    // Allow Charlie
    mockDb.allowedUsersSet.add(1003);
    await mockDb.upsertUser({ telegram_id: 1003, first_name: 'Charlie' });

    // 2nd use by Charlie -> rejected!
    const joinCharlie = await makeAuthRequest(userC, 'POST', '/invites/join', { code });
    expect(joinCharlie.status).toBe(400);
    const body = await joinCharlie.json();
    expect(body.code).toBe('INVITE_ALREADY_USED');
  });

  it('ensures user A cannot view or manipulate pantry B where they are not a member', async () => {
    const pantryA = await mockDb.createPantry('Alice Secret Pantry', 1001);
    const pantryB = await mockDb.createPantry('Bob Secret Pantry', 1002);

    // Alice tries to get members of Bob's pantry -> 403
    const getMembersRes = await makeAuthRequest(userA, 'GET', `/pantries/${pantryB.id}/members`);
    expect(getMembersRes.status).toBe(403);

    // Bob tries to delete Alice's pantry -> 403
    const deleteRes = await makeAuthRequest(userB, 'DELETE', `/pantries/${pantryA.id}`);
    expect(deleteRes.status).toBe(403);

    // Alice tries to leave Bob's pantry -> 403
    const leaveRes = await makeAuthRequest(userA, 'POST', `/pantries/${pantryB.id}/leave`);
    expect(leaveRes.status).toBe(403);
  });

  it('enforces leave and delete rules (member leaves, owner deletes, owner removes member)', async () => {
    const pantry = await mockDb.createPantry('Family Pantry', 1001);
    // Add Bob as member
    mockDb.membersList.push({
      pantry_id: pantry.id,
      user_id: 1002,
      role: 'member',
      joined_at: fixedNow.toISOString(),
    });

    // 1. Owner cannot leave pantry (must delete or transfer)
    const ownerLeave = await makeAuthRequest(userA, 'POST', `/pantries/${pantry.id}/leave`);
    expect(ownerLeave.status).toBe(400);

    // 2. Member cannot delete pantry
    const memberDelete = await makeAuthRequest(userB, 'DELETE', `/pantries/${pantry.id}`);
    expect(memberDelete.status).toBe(403);

    // 3. Member cannot remove owner or other members
    const memberRemove = await makeAuthRequest(userB, 'POST', `/pantries/${pantry.id}/members/remove`, {
      user_id: 1001,
    });
    expect(memberRemove.status).toBe(403);

    // 4. Member leaves pantry -> succeeds
    const memberLeave = await makeAuthRequest(userB, 'POST', `/pantries/${pantry.id}/leave`);
    expect(memberLeave.status).toBe(200);
    expect(await mockDb.getUserPantryMembership(pantry.id, 1002)).toBeNull();

    // 5. Owner deletes pantry -> succeeds
    const ownerDelete = await makeAuthRequest(userA, 'DELETE', `/pantries/${pantry.id}`);
    expect(ownerDelete.status).toBe(200);
    expect(mockDb.pantriesMap.has(pantry.id)).toBe(false);
  });

  it('updates can_write_pm via POST /user/write-access', async () => {
    const res = await makeAuthRequest(userA, 'POST', '/user/write-access', {
      can_write_pm: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.can_write_pm).toBe(true);
    expect(mockDb.usersMap.get(1001)?.can_write_pm).toBe(true);
  });
});
