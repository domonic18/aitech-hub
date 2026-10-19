/**
 * 数据中心壳根(2026-10-18 数据壳重组):无独立内容,重定向到默认页签「运行」
 * (管线第一入口是源,但落地先看跑了什么;侧栏与旧书签经此归一)。
 */
import { redirect } from "next/navigation";

export default function AdminDataIndexPage(): never {
  redirect("/admin/data/run/");
}
