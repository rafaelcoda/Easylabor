import { inTransaction, type Sql } from '../db';
import { conflict, forbidden, notFound, unprocessable } from '../errors';
import type { AdminLevel, AuthUser, Ctx, Identity } from '../types';
import { normalizePhone } from './accounts';
import { audit } from './manage';

const INVITE_DAYS = 7;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : ((d as string | null) ?? null));
const levelOf = (v: unknown): AdminLevel => (v === 'owner' ? 'owner' : 'operator');
/** Telefone digitado no painel: aceita com ou sem o 55 do Brasil, com máscara, parênteses e traços. */
export function brPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1); // zero de operadora: 027...
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return normalizePhone(d);
}
const last4 = (phone: string) => `…${phone.slice(-4)}`;

/** Garante que, depois da mudança, continua existindo pelo menos um administrador (owner) ativo. */
async function assertAnotherOwner(tx: Sql, exceptId: string) {
  const owners = await tx`SELECT id FROM users WHERE role = 'admin' AND admin_level = 'owner' AND status = 'active' FOR UPDATE`;
  if (!owners.some((o) => o.id !== exceptId)) {
    throw conflict('last_owner', 'Precisa existir pelo menos um administrador ativo. Promova outra pessoa antes.');
  }
}

export async function listTeam(ctx: Ctx, me: AuthUser) {
  const since = new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString();
  const members = await ctx.sql`
    SELECT u.id, u.full_name, u.phone, u.status, u.admin_level, u.created_at,
           (SELECT count(*)::int FROM audit_logs a WHERE a.actor_id = u.id AND a.created_at > ${since}::timestamptz) AS actions_30d,
           (SELECT max(a.created_at) FROM audit_logs a WHERE a.actor_id = u.id) AS last_action
    FROM users u WHERE u.role = 'admin'
    ORDER BY (u.status = 'active') DESC, (u.admin_level = 'owner') DESC NULLS LAST, u.created_at, u.id`;
  const invites = await ctx.sql`
    SELECT i.id, i.phone, i.full_name, i.level, i.created_at, i.expires_at, b.full_name AS invited_by_name
    FROM admin_invites i JOIN users b ON b.id = i.invited_by
    WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC`;
  const now = ctx.now();
  return {
    me: { id: me.id, level: me.adminLevel ?? 'operator' },
    members: members.map((m) => ({
      id: m.id, full_name: m.full_name, phone: m.phone, status: m.status, level: levelOf(m.admin_level), created_at: iso(m.created_at),
      actions_30d: m.actions_30d, last_action: iso(m.last_action),
    })),
    invites: invites.map((i) => ({
      id: i.id, phone: i.phone, full_name: i.full_name, level: levelOf(i.level), created_at: iso(i.created_at), expires_at: iso(i.expires_at),
      expired: (i.expires_at as Date) <= now, invited_by_name: i.invited_by_name,
    })),
  };
}

export async function inviteMember(ctx: Ctx, owner: AuthUser, input: { fullName: string; phone: string; level: AdminLevel }) {
  const phone = brPhone(input.phone);
  if (!phone) throw unprocessable('phone_invalid', 'Informe um telefone válido, com DDD');
  return inTransaction(ctx.sql, async (tx) => {
    if ((await tx`SELECT 1 FROM users WHERE phone = ${phone}`)[0]) {
      throw conflict('phone_in_use', 'Já existe uma conta com este telefone. Convide a pessoa com outro número.');
    }
    const open = (await tx`SELECT id, expires_at FROM admin_invites WHERE phone = ${phone} AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`)[0];
    if (open) {
      if ((open.expires_at as Date) > ctx.now()) throw conflict('invite_exists', 'Já existe um convite em aberto para este telefone.');
      await tx`UPDATE admin_invites SET revoked_at = ${ctx.now().toISOString()}::timestamptz WHERE id = ${open.id}`; // vencido: dá lugar ao novo
    }
    const expires = new Date(ctx.now().getTime() + INVITE_DAYS * 86_400_000);
    const r = await tx`
      INSERT INTO admin_invites (phone, full_name, level, invited_by, created_at, expires_at)
      VALUES (${phone}, ${input.fullName}, ${input.level}, ${owner.id}, ${ctx.now().toISOString()}::timestamptz, ${expires.toISOString()}::timestamptz) RETURNING id`;
    const id = r[0]!.id as string;
    await audit(tx, owner.id, 'team.invited', 'admin_invites', id, null, { name: input.fullName, phone: last4(phone), level: input.level });
    return { id, phone, level: input.level, expires_at: expires.toISOString() };
  });
}

export async function revokeInvite(ctx: Ctx, owner: AuthUser, id: string) {
  await inTransaction(ctx.sql, async (tx) => {
    const r = await tx`UPDATE admin_invites SET revoked_at = ${ctx.now().toISOString()}::timestamptz WHERE id = ${id} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING full_name, phone`;
    if (!r[0]) throw notFound('Convite');
    await audit(tx, owner.id, 'team.invite_revoked', 'admin_invites', id, { name: r[0].full_name, phone: last4(String(r[0].phone)) }, null);
  });
}

export async function setMemberLevel(ctx: Ctx, owner: AuthUser, memberId: string, level: AdminLevel) {
  return inTransaction(ctx.sql, async (tx) => {
    const m = (await tx`SELECT id, role, status, admin_level FROM users WHERE id = ${memberId} FOR UPDATE`)[0];
    if (!m || m.role !== 'admin') throw notFound('Membro da equipe');
    const before = levelOf(m.admin_level);
    if (before === level) return { id: memberId, level };
    if (before === 'owner' && m.status === 'active') await assertAnotherOwner(tx, memberId);
    await tx`UPDATE users SET admin_level = ${level} WHERE id = ${memberId}`;
    await audit(tx, owner.id, 'team.level_changed', 'users', memberId, { level: before }, { level });
    return { id: memberId, level };
  });
}

export async function setMemberStatus(ctx: Ctx, owner: AuthUser, memberId: string, action: 'deactivate' | 'reactivate') {
  if (action === 'deactivate' && memberId === owner.id) throw forbidden('Você não pode desativar o seu próprio acesso');
  return inTransaction(ctx.sql, async (tx) => {
    const m = (await tx`SELECT id, role, status, admin_level FROM users WHERE id = ${memberId} FOR UPDATE`)[0];
    if (!m || m.role !== 'admin') throw notFound('Membro da equipe');
    if (action === 'deactivate') {
      if (m.status !== 'active') throw conflict('invalid_state', 'Só é possível desativar um acesso ativo');
      if (levelOf(m.admin_level) === 'owner') await assertAnotherOwner(tx, memberId);
    } else if (m.status !== 'suspended') {
      throw conflict('invalid_state', 'Só é possível reativar um acesso desativado');
    }
    const to = action === 'deactivate' ? 'suspended' : 'active';
    await tx`UPDATE users SET status = ${to} WHERE id = ${memberId}`;
    await audit(tx, owner.id, action === 'deactivate' ? 'team.deactivated' : 'team.reactivated', 'users', memberId, { status: m.status }, { status: to });
    return { id: memberId, status: to };
  });
}

/**
 * Chamado quando alguém entra com um telefone convidado e ainda não tem conta: cria o acesso com o nível do convite.
 * A garantia de que a pessoa é dona do telefone vem do código por SMS do login.
 */
export async function acceptInvite(ctx: Ctx, identity: Identity) {
  const phone = normalizePhone(identity.phone);
  if (!phone) throw unprocessable('phone_missing', 'O login precisa de um telefone verificado');
  return inTransaction(ctx.sql, async (tx) => {
    if ((await tx`SELECT 1 FROM users WHERE id = ${identity.id}`)[0]) throw conflict('already_registered', 'Este usuário já está cadastrado');
    const inv = (await tx`
      SELECT id, full_name, level FROM admin_invites
      WHERE phone = ${phone} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ${ctx.now().toISOString()}::timestamptz FOR UPDATE`)[0];
    if (!inv) throw notFound('Convite para este telefone');
    if ((await tx`SELECT 1 FROM users WHERE phone = ${phone}`)[0]) throw conflict('phone_in_use', 'Já existe uma conta com este telefone');
    const now = ctx.now().toISOString();
    await tx`
      INSERT INTO users (id, role, admin_level, full_name, phone, phone_verified_at, accepted_terms_version, accepted_terms_at)
      VALUES (${identity.id}, 'admin', ${inv.level}, ${inv.full_name}, ${phone}, ${now}::timestamptz, 'staff-v1', ${now}::timestamptz)`;
    await tx`UPDATE admin_invites SET accepted_at = ${now}::timestamptz, accepted_user_id = ${identity.id} WHERE id = ${inv.id}`;
    await audit(tx, identity.id, 'team.invite_accepted', 'users', identity.id, null, { level: inv.level });
    return { id: identity.id, role: 'admin' as const, level: levelOf(inv.level) };
  });
}
