import Link from "next/link";

export default function Footer(): React.ReactElement {
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
          © {new Date().getFullYear()} 一起AI · domonic18 的 AI 工程实战博客
        </p>
      </div>
    </footer>
  );
}
