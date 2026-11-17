/**
 * E2E:admin 导航骨架与 router.refresh 互卡回归(2026-11-17 站长反馈)。
 *
 * 背景:admin 全组此前不挂 loading.tsx——M10 批④(2026-10-04,e2e 实证)
 * 记载「admin 段 loading 与 router.refresh() 互卡致变更后内容不出」。
 * 站长现反馈洞察中心/AI 用量点击 2-3s 无响应,要求骨架反馈;
 * 本用例在同一 Next 版本(15.5.26)上重验那条历史约束是否仍成立:
 *
 * ① 导航即时反馈:点侧栏「洞察中心」→ 骨架 1.2s 内可见 → 内容随后到达;
 * ② M10 回归:挂 loading 的 /admin/usage 上执行「清理明细」
 *    (mutation → router.refresh())→ 内容必须回来,不许卡死在骨架;
 * ③ 互卡形态定性(若 ② 失败,截图留档供裁定)。
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

const E2E_ADMIN_PHONE = "13800000000";
const E2E_ADMIN_PASSWORD = "e2e-admin-pass1";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);
  await prisma.userAccount.upsert({
    where: { phone: E2E_ADMIN_PHONE },
    update: { role: "admin", status: "active", passwordHash },
    create: {
      phone: E2E_ADMIN_PHONE,
      nickname: "e2e-admin",
      role: "admin",
      status: "active",
      passwordHash,
    },
  });
  await page.goto("/admin/login");
  await page.getByPlaceholder("手机号 / 用户名 / 邮箱").fill(E2E_ADMIN_PHONE);
  await page.getByPlaceholder("••••••••").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/admin\/?$/);
});

test("① 侧栏点「洞察中心」→ 骨架即时可见,内容随后到达", async ({ page }) => {
  await page.getByRole("link", { name: "洞察中心" }).click();
  // 点击后骨架必须马上出现(1200ms 内)——这就是「点击有响应」的反馈
  await expect(page.getByTestId("admin-page-skeleton")).toBeVisible({ timeout: 1200 });
  // 骨架退场、真实内容到位(重查询页给足窗口)
  await expect(page.getByTestId("admin-page-skeleton")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "洞察中心" })).toBeVisible();
});

test("① 侧栏点「AI 用量」→ 骨架即时可见,内容随后到达", async ({ page }) => {
  await page.getByRole("link", { name: "AI 用量" }).click();
  await expect(page.getByTestId("admin-page-skeleton")).toBeVisible({ timeout: 1200 });
  await expect(page.getByTestId("admin-page-skeleton")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText("估算费用")).toBeVisible();
});

test("② M10 回归:挂 loading 的用量页执行清理(refresh)后内容必须回来", async ({ page }) => {
  await page.goto("/admin/usage");
  await expect(page.getByText("估算费用").first()).toBeVisible({ timeout: 30_000 });

  // 清理按钮走 confirm → fetch → alert → router.refresh();
  // dialog 全接管并吞掉测试收尾期的迟到 accept 异常
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.accept().catch(() => {});
  });
  await page.getByRole("button", { name: "清理明细" }).click();
  // 等 alert(已清理 N 行)到位 = mutation 落定,refresh 已发出
  await expect
    .poll(() => dialogs.some((m) => m.includes("已清理")), { timeout: 10_000 })
    .toBe(true);

  // refresh 后:10s 内 KPI 内容仍可见(允许骨架闪一下再回来),
  // 卡死在骨架 = M10 历史问题复发——失败时截图留档
  await expect(page.getByText("估算费用").first()).toBeVisible({ timeout: 10_000 });
});

test("③ 全组覆盖抽样:「数据中心」与根仪表盘导航正常到达", async ({ page }) => {
  // 轻量页本地空库下 RSC 秒回,骨架闪现短于轮询间隔——骨架即时性锚定在
  // 重页(①×2)上;此处只断言导航与内容到达(全组 loading 文件存在性由
  // 构建期保证:缺 loading 的段不会出现该 testid,①③ 共同覆盖机制面)。
  await page.getByRole("link", { name: "数据中心" }).click();
  // data 壳根无独立内容,重定向首页签「源管理」(/admin/data/sources)
  await expect(page).toHaveURL(/\/admin\/data\/sources/);

  // 折返根仪表盘(「站点统计」同时出现在侧栏与顶栏,锚定侧栏)
  await page.getByRole("navigation").getByRole("link", { name: "站点统计" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByText("今日 PV").first()).toBeVisible();
});
