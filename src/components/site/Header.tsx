import Link from "next/link";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/articles/", label: "文章" },
  { href: "/archive/", label: "归档" },
  { href: "/about/", label: "关于" },
];

export default function Header(): React.ReactElement {
  return (
    <header className="border-b border-neutral-200/60">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          一起<span className="text-sky-600">AI</span>技术
        </Link>
        <nav className="flex flex-1 items-center gap-4 text-sm text-neutral-600">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-neutral-950">
              {item.label}
            </Link>
          ))}
        </nav>
        <form action="/search" className="flex items-center gap-1">
          <input
            type="search"
            name="q"
            placeholder="搜索文章"
            aria-label="搜索文章"
            className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sky-500 sm:w-40"
          />
        </form>
      </div>
    </header>
  );
}
