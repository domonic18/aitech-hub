/**
 * admin 账号创建/重置密码(arch/05-services §3.1,M4 交付):
 *   npm run admin
 * 交互式输入手机号与密码;手机号已存在则重置密码并提为 admin(upsert 语义,重跑即改密)。
 * 密码不回显;bcrypt 10 轮;`legacy_phpass` 不参与校验(纯审计)。
 */
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { stdin, stdout } from "node:process";
import { ADMIN_ROLE } from "../src/lib/auth/constants";
import { maskPhone } from "../src/lib/auth/mask";
import { PHONE_RE, validatePassword } from "../src/lib/auth/rules";

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

function assertTty(): void {
  if (!stdin.isTTY) {
    throw new Error("密码输入需要交互式终端(TTY);请直接在终端运行 npm run admin");
  }
}

/**
 * raw 模式行读取(不引入 readline 接口——它与手工监听会双路消费按键并泄漏回显)。
 * echo 控制是否回显(密码不回显);退格可删,Ctrl+C/Ctrl+D 退出。
 */
function askRaw(query: string, echo: boolean): Promise<string> {
  return new Promise((resolve) => {
    // 先挂监听再出题:慢启动的终端自动化(expect 等)会在 query 写出后毫秒级回灌输入
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (ch: string): void => {
      if (ch === "\r" || ch === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(input);
      } else if (ch === "\u0003" || ch === "\u0004") {
        stdout.write("\n已取消\n");
        process.exit(130);
      } else if (ch === "\u007f" || ch === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          if (echo) stdout.write("\b \b");
        }
      } else {
        input += ch;
        if (echo) stdout.write(ch);
      }
    };
    stdin.on("data", onData);
    stdout.write(query);
  });
}

async function main(): Promise<void> {
  assertTty();

  let phone = "";
  for (;;) {
    phone = (await askRaw("手机号(即登录账号):", true)).trim();
    if (PHONE_RE.test(phone)) break;
    console.log("格式不对:应为 11 位大陆手机号(1[3-9] 开头)");
  }

  let password = "";
  for (;;) {
    password = await askRaw("密码(输入不回显):", false);
    const err = validatePassword(password);
    if (err) {
      console.log(`${err},请重输`);
      continue;
    }
    const confirm = await askRaw("确认密码:", false);
    if (confirm === password) break;
    console.log("两次输入不一致,请重输");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existing = await prisma.userAccount.findUnique({ where: { phone } });
  if (existing?.status === "disabled") {
    console.log(`注意:账号 ${maskPhone(phone)} 原为 disabled,本次重置将同时恢复为 active`);
  }

  const user = await prisma.userAccount.upsert({
    where: { phone },
    update: { role: ADMIN_ROLE, passwordHash, status: "active" },
    create: { phone, role: ADMIN_ROLE, status: "active", passwordHash },
  });

  console.log(
    JSON.stringify({
      event: existing ? "admin.password_reset" : "admin.created",
      userId: user.id.toString(),
      phone: maskPhone(phone),
      role: user.role,
    }),
  );
  if (existing) console.log("已有账号:密码已重置并提为 admin(重跑本脚本即改密)");
  else console.log("admin 账号已创建");
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ event: "admin.failed", error: String(err) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0); // raw tty 句柄可能滞留事件循环,CLI 显式退出
  });
