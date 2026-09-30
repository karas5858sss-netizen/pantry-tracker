import React, { useState, useEffect } from 'react';
import {
  type Pantry,
  type PantryMember,
  type InviteInfo,
  createInvite,
  getPantryMembers,
  removePantryMember,
  leavePantry,
  deletePantry,
  createPantry,
  joinPantry,
} from '../api.ts';
import { t, type SupportedLanguage } from '@shared/i18n.ts';
import { triggerHaptic } from '../telegram.ts';

interface PantryModalProps {
  isOpen: boolean;
  onClose: () => void;
  pantries: Pantry[];
  currentPantry: Pantry;
  currentUserId: number;
  lang: SupportedLanguage;
  onSelectPantry: (pantry: Pantry) => void;
  onUpdatePantries: (pantries: Pantry[], newActive?: Pantry) => void;
}

export const PantryModal: React.FC<PantryModalProps> = ({
  isOpen,
  onClose,
  pantries,
  currentPantry,
  currentUserId,
  lang,
  onSelectPantry,
  onUpdatePantries,
}) => {
  const [activeTab, setActiveTab] = useState<'switch' | 'invite' | 'members' | 'create'>('switch');
  const [members, setMembers] = useState<PantryMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [newPantryName, setNewPantryName] = useState('');
  const [creatingPantry, setCreatingPantry] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inputInviteCode, setInputInviteCode] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);

  // Load members when members tab is opened
  useEffect(() => {
    if (isOpen && activeTab === 'members') {
      setLoadingMembers(true);
      getPantryMembers(currentPantry.id).then((res) => {
        if (res.data) setMembers(res.data.members);
        setLoadingMembers(false);
      });
    }
  }, [isOpen, activeTab, currentPantry.id]);

  if (!isOpen) return null;

  const handleGenerateInvite = async () => {
    setLoadingInvite(true);
    setActionError(null);
    const res = await createInvite(currentPantry.id);
    if (res.data) {
      setInvite(res.data);
      triggerHaptic('success');
    } else if (res.error) {
      setActionError(res.error.error);
      triggerHaptic('error');
    }
    setLoadingInvite(false);
  };

  const handleCopyInvite = () => {
    if (!invite) return;
    navigator.clipboard?.writeText(invite.inviteUrl);
    setCopiedLink(true);
    triggerHaptic('light');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleShareTelegram = () => {
    if (!invite) return;
    const text = encodeURIComponent(t(lang, 'pantry_share_text'));
    const url = encodeURIComponent(invite.inviteUrl);
    const shareUrl = `https://t.me/share/url?url=${url}&text=${text}`;

    if (window.Telegram?.WebApp && 'openTelegramLink' in window.Telegram.WebApp) {
      // @ts-expect-error Telegram WebApp method
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank');
    }
  };

  const handleCreateNewPantry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPantryName.trim()) return;

    setCreatingPantry(true);
    setActionError(null);
    const res = await createPantry(newPantryName.trim());
    if (res.data) {
      const newPantry = res.data.pantry;
      const updated = [...pantries, newPantry];
      onUpdatePantries(updated, newPantry);
      setNewPantryName('');
      setActiveTab('switch');
      triggerHaptic('success');
    } else if (res.error) {
      setActionError(res.error.error);
      triggerHaptic('error');
    }
    setCreatingPantry(false);
  };

  const handleLeave = async () => {
    if (!confirm(t(lang, 'pantry_leave_confirm'))) return;
    setActionError(null);
    const res = await leavePantry(currentPantry.id);
    if (res.data) {
      const updated = res.data.pantries;
      onUpdatePantries(updated, updated[0]);
      onClose();
      triggerHaptic('success');
    } else if (res.error) {
      setActionError(res.error.error);
      triggerHaptic('error');
    }
  };

  const handleDelete = async () => {
    if (!confirm(t(lang, 'pantry_delete_confirm'))) return;
    setActionError(null);
    const res = await deletePantry(currentPantry.id);
    if (res.data) {
      const updated = res.data.pantries;
      onUpdatePantries(updated, updated[0]);
      onClose();
      triggerHaptic('success');
    } else if (res.error) {
      setActionError(res.error.error);
      triggerHaptic('error');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm(t(lang, 'pantry_remove_confirm'))) return;
    setActionError(null);
    const res = await removePantryMember(currentPantry.id, userId);
    if (res.data) {
      setMembers(res.data.members);
      triggerHaptic('light');
    } else if (res.error) {
      setActionError(res.error.error);
      triggerHaptic('error');
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputInviteCode.trim();
    if (!trimmed) return;

    const match =
      trimmed.match(/startapp=join_([A-Za-z0-9_-]+)/) ||
      trimmed.match(/join_([A-Za-z0-9_-]+)/) ||
      trimmed.match(/([A-Za-z0-9_-]{16,64})/);
    const code = match ? match[1] : trimmed;

    setJoiningByCode(true);
    setActionError(null);
    const res = await joinPantry(code);
    if (res.data) {
      onUpdatePantries(res.data.pantries, res.data.pantry);
      setInputInviteCode('');
      triggerHaptic('success');
      onClose();
    } else if (res.error) {
      setActionError(res.error.error);
      triggerHaptic('error');
    }
    setJoiningByCode(false);
  };

  const isOwner = currentPantry.role === 'owner';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-tg-bg text-tg-text rounded-t-3xl sm:rounded-2xl border border-tg-hint/20 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-slide-up">
        {/* Modal Header */}
        <div className="p-4 border-b border-tg-hint/15 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-tg-text flex items-center gap-1.5">
              <span>🏠</span>
              <span>{t(lang, 'pantry_management')}</span>
            </h2>
            <p className="text-xs text-tg-hint font-medium">
              {currentPantry.name} ({currentPantry.role === 'owner' ? t(lang, 'pantry_role_owner') : t(lang, 'pantry_role_member')})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-tg-secondary text-tg-hint hover:text-tg-text flex items-center justify-center text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="grid grid-cols-4 gap-1 p-2 bg-tg-secondary/50 border-b border-tg-hint/10 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('switch')}
            className={`py-1.5 px-1 rounded-lg transition text-center ${
              activeTab === 'switch' ? 'bg-tg-bg text-tg-text shadow-xs' : 'text-tg-hint'
            }`}
          >
            {t(lang, 'pantry_title_list', { count: pantries.length })}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('invite')}
            className={`py-1.5 px-1 rounded-lg transition text-center ${
              activeTab === 'invite' ? 'bg-tg-bg text-tg-text shadow-xs' : 'text-tg-hint'
            }`}
          >
            {t(lang, 'pantry_invite_btn')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`py-1.5 px-1 rounded-lg transition text-center ${
              activeTab === 'members' ? 'bg-tg-bg text-tg-text shadow-xs' : 'text-tg-hint'
            }`}
          >
            {t(lang, 'pantry_members_tab')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`py-1.5 px-1 rounded-lg transition text-center ${
              activeTab === 'create' ? 'bg-tg-bg text-tg-text shadow-xs' : 'text-tg-hint'
            }`}
          >
            {t(lang, 'pantry_new_btn')}
          </button>
        </div>

        {/* Content body */}
        <div className="p-4 overflow-y-auto flex-1 text-xs">
          {actionError && (
            <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl">
              {actionError}
            </div>
          )}

          {/* TAB 1: SWITCH PANTRIES */}
          {activeTab === 'switch' && (
            <div className="space-y-2">
              <p className="text-tg-hint mb-1">{t(lang, 'pantry_choose_active')}</p>
              {pantries.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    onSelectPantry(p);
                    triggerHaptic('light');
                    onClose();
                  }}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                    p.id === currentPantry.id
                      ? 'bg-tg-button/10 border-tg-button font-bold text-tg-text'
                      : 'bg-tg-secondary border-tg-hint/15 text-tg-text hover:bg-tg-secondary/80'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{p.role === 'owner' ? '👑' : '👥'}</span>
                    <div>
                      <div>{p.name}</div>
                      <div className="text-[10px] text-tg-hint font-normal">
                        {p.role === 'owner' ? t(lang, 'pantry_role_owner') : t(lang, 'pantry_role_member')}
                      </div>
                    </div>
                  </div>
                  {p.id === currentPantry.id && (
                    <span className="text-emerald-500 text-sm font-bold">✓</span>
                  )}
                </div>
              ))}

              <form onSubmit={handleJoinByCode} className="pt-3 border-t border-tg-hint/15 space-y-1.5">
                <label className="block text-[11px] font-medium text-tg-hint">
                  {t(lang, 'invite_enter_code_placeholder')}:
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={inputInviteCode}
                    onChange={(e) => setInputInviteCode(e.target.value)}
                    placeholder={t(lang, 'pantry_code_placeholder')}
                    className="flex-1 p-2 rounded-xl bg-tg-secondary border border-tg-hint/20 text-tg-text text-xs focus:outline-none focus:ring-1 focus:ring-tg-button"
                  />
                  <button
                    type="submit"
                    disabled={joiningByCode || !inputInviteCode.trim()}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl text-xs transition disabled:opacity-50"
                  >
                    {joiningByCode ? '...' : t(lang, 'invite_join_btn')}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: INVITE */}
          {activeTab === 'invite' && (
            <div className="flex flex-col items-center text-center">
              <div className="text-3xl mb-2">🔗</div>
              <h3 className="font-bold text-sm text-tg-text mb-1">
                {t(lang, 'pantry_invite_heading', { name: currentPantry.name })}
              </h3>
              <p className="text-tg-hint text-[11px] mb-3 leading-relaxed">
                {t(lang, 'invite_created')}
              </p>

              {invite ? (
                <div className="w-full bg-tg-secondary p-3 rounded-xl border border-tg-hint/20 text-left space-y-2">
                  <div className="font-mono text-[11px] bg-tg-bg p-2 rounded-lg break-all text-tg-text select-all">
                    {invite.inviteUrl}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="py-2 px-3 bg-tg-button text-tg-button rounded-lg font-medium text-xs transition"
                    >
                      {copiedLink ? t(lang, 'copied') : t(lang, 'invite_copy')}
                    </button>
                    <button
                      type="button"
                      onClick={handleShareTelegram}
                      className="py-2 px-3 bg-emerald-600 text-white rounded-lg font-medium text-xs transition"
                    >
                      {t(lang, 'invite_share_tg')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateInvite}
                  disabled={loadingInvite}
                  className="w-full py-2.5 px-4 bg-tg-button text-tg-button font-medium rounded-xl text-xs transition disabled:opacity-50"
                >
                  {loadingInvite ? t(lang, 'pantry_invite_gen_loading') : t(lang, 'pantry_invite_gen_btn')}
                </button>
              )}
            </div>
          )}

          {/* TAB 3: MEMBERS */}
          {activeTab === 'members' && (
            <div>
              <p className="text-tg-hint mb-2">{t(lang, 'pantry_members_title')}:</p>
              {loadingMembers ? (
                <p className="text-center text-tg-hint py-4">{t(lang, 'pantry_loading_list')}</p>
              ) : (
                <div className="space-y-1.5">
                  {members.map((m) => (
                    <div
                      key={m.user_id}
                      className="p-2.5 bg-tg-secondary rounded-xl flex items-center justify-between border border-tg-hint/10"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{m.role === 'owner' ? '👑' : '👤'}</span>
                        <div>
                          <div className="font-medium text-tg-text">
                            {m.first_name} {m.user_id === currentUserId && t(lang, 'pantry_member_you')}
                          </div>
                          {m.username && (
                            <div className="text-[10px] text-tg-hint">@{m.username}</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-tg-bg text-tg-hint font-medium">
                          {m.role === 'owner' ? t(lang, 'pantry_role_owner') : t(lang, 'pantry_role_member')}
                        </span>
                        {isOwner && m.user_id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.user_id)}
                            className="text-red-500 hover:text-red-600 font-bold p-1 text-xs"
                            title={t(lang, 'pantry_member_remove_title')}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CREATE NEW PANTRY */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreateNewPantry} className="space-y-3">
              <label className="block text-tg-hint font-medium">
                {t(lang, 'pantry_create_title')}:
              </label>
              <input
                type="text"
                value={newPantryName}
                onChange={(e) => setNewPantryName(e.target.value)}
                placeholder={t(lang, 'pantry_name_placeholder')}
                className="w-full p-3 rounded-xl bg-tg-secondary border border-tg-hint/20 text-tg-text focus:outline-none focus:ring-2 focus:ring-tg-button text-sm"
                autoFocus
              />
              <button
                type="submit"
                disabled={creatingPantry || !newPantryName.trim()}
                className="w-full py-2.5 bg-tg-button text-tg-button font-medium rounded-xl text-xs transition disabled:opacity-50"
              >
                {creatingPantry ? t(lang, 'pantry_creating') : t(lang, 'pantry_create_btn')}
              </button>
            </form>
          )}

          {/* DANGER ACTIONS */}
          <div className="mt-6 pt-3 border-t border-tg-hint/15 flex items-center justify-between">
            {!isOwner ? (
              <button
                type="button"
                onClick={handleLeave}
                className="text-red-500 hover:underline font-medium text-[11px]"
              >
                🚪 {t(lang, 'pantry_leave_btn')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleDelete}
                className="text-red-500 hover:underline font-medium text-[11px]"
              >
                🗑 {t(lang, 'pantry_delete_btn')}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="text-tg-hint hover:text-tg-text text-[11px]"
            >
              {t(lang, 'btn_cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
