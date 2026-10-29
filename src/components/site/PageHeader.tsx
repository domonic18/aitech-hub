/**
 * 站点页头样板(P2-16 自 code-review-20261029 收敛:/topics/ 与 /pricing/ 的
 * eyebrow + h1 + desc 三行页头逐字同构,section 容器一并收编,children 为
 * 页头下正文):
 * - eyebrow 缺省 = 无眉题页头(/archive/ 变体预留;其现结构含 border-b 计数行,
 *   暂按原样不强改,后续对齐时再迁入);
 * - maxW 缺省站点宽容器 var(--site-max-w);窄页可传如 "max-w-3xl"。
 * 纯展示 RSC。
 */
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  maxW = "max-w-[var(--site-max-w)]",
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  /** 容器 max-w 类(缺省站点宽;窄页传如 "max-w-3xl") */
  maxW?: string;
  children?: ReactNode;
}): React.ReactElement {
  return (
    <section className={`mx-auto w-full ${maxW}`}>
      {eyebrow && <p className="font-mono text-[11px] tracking-[0.2em] text-blue">{eyebrow}</p>}
      <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{title}</h1>
      <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-text-2">{description}</p>
      {children}
    </section>
  );
}
