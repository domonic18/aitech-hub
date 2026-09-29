/** 首页占位(M1 骨架验收:/api/health 通、空库可起;首页随 M3 实现) */
export default function HomePage(): React.ReactElement {
  return (
    <main>
      <h1 className="text-3xl font-bold">一起AI技术</h1>
      <p className="mt-4 text-neutral-600">站点骨架已就绪,内容功能按 development-plan M3 交付。</p>
    </main>
  );
}
