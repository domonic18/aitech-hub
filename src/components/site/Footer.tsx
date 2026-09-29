import Link from "next/link";

export default function Footer(): React.ReactElement {
  return (
    <footer className="mt-16 border-t border-neutral-200/60">
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-neutral-500">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/about/" className="hover:text-neutral-800">
            关于
          </Link>
          <Link href="/agreement/" className="hover:text-neutral-800">
            用户协议
          </Link>
          <Link href="/privacy/" className="hover:text-neutral-800">
            隐私政策
          </Link>
          <Link href="/archive/" className="hover:text-neutral-800">
            归档
          </Link>
          <a href="/feed.xml" className="hover:text-neutral-800">
            RSS
          </a>
          <a
            href="https://github.com/domonic18"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-neutral-800"
          >
            GitHub
          </a>
        </div>
        <p className="mt-4">
          © {new Date().getFullYear()} 一起AI技术 · domonic18 的 AI 工程实战博客
        </p>
      </div>
    </footer>
  );
}
