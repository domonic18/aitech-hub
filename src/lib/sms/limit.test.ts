/**
 * 短信频控单测(M65):Redis 用内存 Map 替身,覆盖预算按东八区自然日切窗、
 * 三层闸门(同号/IP/全局预算)判定、先占位后回滚、校验失败锁定。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const expires = new Map<string, number>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, _ex?: string, ttl?: number) => {
      store.set(k, v);
      if (typeof ttl === "number") expires.set(k, ttl);
      return "OK";
    },
    del: async (k: string) => void store.delete(k),
    incr: async (k: string) => {
      const n = Number(store.get(k) ?? "0") + 1;
      store.set(k, String(n));
      return n;
    },
    decr: async (k: string) => {
      const n = Number(store.get(k) ?? "0") - 1;
      store.set(k, String(n));
      return n;
    },
    expire: async (k: string, sec: number) => {
      expires.set(k, sec);
      return 1;
    },
  },
}));

import {
  SMS_BUDGET_WARN_RATIO,
  SMS_IP_HOUR_LIMIT,
  SMS_PHONE_COOLDOWN_SECONDS,
  SMS_PHONE_HOUR_LIMIT,
  SMS_VERIFY_FAIL_LIMIT,
  SMS_VERIFY_LOCK_SECONDS,
  budgetDayStamp,
  checkSendQuota,
  clearVerifyFails,
  getSendBudgetUsage,
  isVerifyLocked,
  recordSend,
  recordVerifyFail,
  releaseSendBudget,
  reserveSendBudget,
} from "./limit";

const PHONE = "13812341234";
const IP = "203.0.113.9";

beforeEach(() => {
  store.clear();
  expires.clear();
});

describe("budgetDayStamp(东八区自然日)", () => {
  it("UTC 15:59 仍属当日(东八 23:59)", () => {
    expect(budgetDayStamp(new Date("2026-10-31T15:59:59.000Z"))).toBe("2026-10-31");
  });

  it("UTC 16:00 跨入次日(东八 00:00)", () => {
    expect(budgetDayStamp(new Date("2026-10-31T16:00:00.000Z"))).toBe("2026-11-01");
  });

  it("UTC 00:00 对应东八同日 08:00", () => {
    expect(budgetDayStamp(new Date("2026-10-31T00:00:00.000Z"))).toBe("2026-10-31");
  });
});

describe("checkSendQuota(发送前只读闸门)", () => {
  it("全新号码与 IP 放行", async () => {
    expect(await checkSendQuota(PHONE, IP, 200)).toEqual({ ok: true });
  });

  it("冷却键在 → 判同号受限并带 TTL", async () => {
    await recordSend(PHONE, IP);
    expect(expires.get(`sms:send:phone:cd:${PHONE}`)).toBe(SMS_PHONE_COOLDOWN_SECONDS);
    expect(await checkSendQuota(PHONE, IP, 200)).toEqual({ ok: false, scope: "phone" });
  });

  it("同号小时桶达上限 → 判同号受限", async () => {
    store.set(`sms:send:phone:h:${PHONE}`, String(SMS_PHONE_HOUR_LIMIT));
    expect(await checkSendQuota(PHONE, IP, 200)).toEqual({ ok: false, scope: "phone" });
  });

  it("同 IP 小时桶达上限 → 判 IP 受限", async () => {
    store.set(`sms:send:ip:h:${IP}`, String(SMS_IP_HOUR_LIMIT));
    expect(await checkSendQuota(PHONE, IP, 200)).toEqual({ ok: false, scope: "ip" });
  });

  it("空 IP 不查 IP 桶", async () => {
    store.set("sms:send:ip:h:", String(SMS_IP_HOUR_LIMIT));
    expect(await checkSendQuota(PHONE, "", 200)).toEqual({ ok: true });
  });

  it("全局预算用尽 → 判预算熔断", async () => {
    await reserveSendBudget(2);
    await reserveSendBudget(2);
    expect(await checkSendQuota(PHONE, IP, 2)).toEqual({ ok: false, scope: "budget" });
  });
});

describe("预算先占位后回滚", () => {
  it("限额内占位成功,超限占位失败且不吞额度", async () => {
    expect(await reserveSendBudget(2)).toBe(true);
    expect(await reserveSendBudget(2)).toBe(true);
    expect(await reserveSendBudget(2)).toBe(false);
    expect(await getSendBudgetUsage()).toBe(2);
  });

  it("首次占位设日窗 TTL(日 + 1 小时冗余)", async () => {
    await reserveSendBudget(5);
    expect(expires.values().next().value).toBe(25 * 3600);
  });

  it("发送失败归还占位", async () => {
    await reserveSendBudget(5);
    expect(await getSendBudgetUsage()).toBe(1);
    await releaseSendBudget();
    expect(await getSendBudgetUsage()).toBe(0);
  });

  it("归还不会把用量压成负数", async () => {
    await releaseSendBudget();
    expect(await getSendBudgetUsage()).toBe(0);
  });
});

describe("recordSend", () => {
  it("置冷却并累计同号/同 IP 桶", async () => {
    await recordSend(PHONE, IP);
    expect(store.get(`sms:send:phone:cd:${PHONE}`)).toBe("1");
    expect(store.get(`sms:send:phone:h:${PHONE}`)).toBe("1");
    expect(store.get(`sms:send:phone:d:${PHONE}`)).toBe("1");
    expect(store.get(`sms:send:ip:h:${IP}`)).toBe("1");
    expect(store.get(`sms:send:ip:d:${IP}`)).toBe("1");
  });

  it("空 IP 不记账 IP 桶", async () => {
    await recordSend(PHONE, "");
    expect(store.has("sms:send:ip:h:")).toBe(false);
    expect(store.get(`sms:send:phone:h:${PHONE}`)).toBe("1");
  });
});

describe("验证码校验失败锁定", () => {
  it("错 5 次锁定 15 分钟,清零后解锁", async () => {
    for (let i = 0; i < SMS_VERIFY_FAIL_LIMIT - 1; i++) await recordVerifyFail(PHONE);
    expect(await isVerifyLocked(PHONE)).toBe(false);
    expect(await recordVerifyFail(PHONE)).toBe(SMS_VERIFY_FAIL_LIMIT);
    expect(await isVerifyLocked(PHONE)).toBe(true);
    expect(expires.get(`sms:verify:fail:${PHONE}`)).toBe(SMS_VERIFY_LOCK_SECONDS);
    await clearVerifyFails(PHONE);
    expect(await isVerifyLocked(PHONE)).toBe(false);
  });
});

describe("预算预警线", () => {
  it("处于 (0,1) 区间,便于 80% 提前告警", () => {
    expect(SMS_BUDGET_WARN_RATIO).toBeGreaterThan(0);
    expect(SMS_BUDGET_WARN_RATIO).toBeLessThan(1);
  });
});
