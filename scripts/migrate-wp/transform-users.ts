/**
 * 用户映射(纯函数):296 全量,手机号校验/去重,
 * administrator → admin,无有效手机号 → pending_binding。
 */
import type { MigrationWarning, UserPlan, WpUserMetaRow, WpUserRow } from "./types";

const PHONE_RE = /^1\d{10}$/;

function gmtToIso(mysqlDatetime: string): string {
  return new Date(`${mysqlDatetime.replace(" ", "T")}Z`).toISOString();
}

function metaMap(userMeta: WpUserMetaRow[]): Map<number, Map<string, string>> {
  const byUser = new Map<number, Map<string, string>>();
  for (const m of userMeta) {
    const mm = byUser.get(m.user_id) ?? new Map<string, string>();
    mm.set(m.meta_key, m.meta_value);
    byUser.set(m.user_id, mm);
  }
  return byUser;
}

/** wp_capabilities 是 PHP 序列化串,administrator 出现即认定(实库仅站长 1 人) */
function isAdmin(caps: string | undefined): boolean {
  return !!caps && caps.includes("administrator");
}

export function transformUsers(
  users: WpUserRow[],
  userMeta: WpUserMetaRow[],
): { users: UserPlan[]; warnings: MigrationWarning[] } {
  const warnings: MigrationWarning[] = [];
  const metas = metaMap(userMeta);

  // 第一遍:映射 + 手机号校验
  const plans = new Map<number, UserPlan & { rawPhone: string | null }>();
  for (const u of users) {
    const mm = metas.get(u.ID) ?? new Map<string, string>();
    const rawPhone = (mm.get("mobile_phone") ?? "").trim() || null;
    let phone: string | null = null;
    if (rawPhone) {
      if (PHONE_RE.test(rawPhone)) phone = rawPhone;
      else {
        warnings.push({
          scope: "user.phone_invalid",
          wpId: u.ID,
          message: `手机号格式非法,按无手机号处理(${u.user_login})`,
        });
      }
    }
    // user_login 为 11 位纯数字时回填(实库 0 例,防御性保留)
    if (!phone && PHONE_RE.test(u.user_login)) phone = u.user_login;

    const nickname = (mm.get("nickname") ?? "").trim() || u.display_name.trim() || null;
    const bio = (mm.get("description") ?? "").trim() || null;

    plans.set(u.ID, {
      wpUserId: u.ID,
      phone,
      nickname,
      bio: bio ? bio.slice(0, 500) : null,
      role: isAdmin(mm.get("wp_capabilities")) ? "admin" : "user",
      status: phone ? "active" : "pending_binding",
      legacyUsername: u.user_login,
      legacyPhpass: u.user_pass,
      createdAt: gmtToIso(u.user_registered),
      rawPhone,
    });
  }

  // 第二遍:手机号去重 —— 同号保留最早注册者,其余转 pending_binding(03 §6)
  const byPhone = new Map<string, Array<UserPlan & { rawPhone: string | null }>>();
  for (const p of plans.values()) {
    if (!p.phone) continue;
    const list = byPhone.get(p.phone) ?? [];
    list.push(p);
    byPhone.set(p.phone, list);
  }
  for (const list of byPhone.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const [winner, ...losers] = list;
    warnings.push({
      scope: "user.phone_duplicate",
      wpId: winner.wpUserId,
      message: `手机号重复 ${losers.length} 人,保留最早注册者 wp_user_id=${winner.wpUserId},其余转 pending_binding`,
    });
    for (const loser of losers) {
      loser.phone = null;
      loser.status = "pending_binding";
    }
  }

  const out = [...plans.values()].map((p) => {
    const { rawPhone, ...plan } = p;
    void rawPhone;
    return plan;
  });
  return { users: out, warnings };
}
