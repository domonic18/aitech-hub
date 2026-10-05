import Link from "next/link";

import packageInfo from "../../../package.json";
import { getSiteIcp, getSiteTitle } from "@/lib/config/site-config";

export default async function Footer(): Promise<React.ReactElement> {
  const [siteTitle, icp] = await Promise.all([getSiteTitle(), getSiteIcp()]);
  // 构建信息行(2026-10-05 版本追踪需求):NEXT_PUBLIC_ 构建期注入(CI build-args /
  // scripts/build-with-info.sh 本地回退 git describe),均缺省显示 dev
  const buildRef = process.env.NEXT_PUBLIC_BUILD_REF || "dev";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto w-full max-w-[var(--site-max-w)] px-4 py-8 text-sm text-text-2 sm:px-6">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/about/" className="hover:text-text-1">
            关于
          </Link>
          <Link href="/agreement/" className="hover:text-text-1">
            用户协议
          </Link>
          <Link href="/privacy/" className="hover:text-text-1">
            隐私政策
          </Link>
          <Link href="/archive/" className="hover:text-text-1">
            归档
          </Link>
          <a href="/feed.xml" className="hover:text-text-1">
            RSS
          </a>
          <a
            href="https://github.com/domonic18"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-1"
          >
            GitHub
          </a>
        </div>
        <p className="mt-4 text-text-3">
          © {new Date().getFullYear()} {siteTitle} · domonic18 的 AI 工程实战博客
        </p>
        {icp ? (
          <p className="mt-1 text-text-3">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-1"
            >
              {icp}
            </a>
          </p>
        ) : null}
        <p className="mt-1 font-mono text-[11px] text-text-3">
          v{packageInfo.version} · {buildRef}
          {buildTime ? ` · 构建于 ${buildTime.slice(0, 16).replace("T", " ")} UTC` : ""}
        </p>
      </div>
    </footer>
  );
}
