/**
 * 数据中心壳根(IA v5 板定):无独立内容,重定向到首页签「源管理」(管线
 * 起点;侧栏与旧书签经此归一)。
 */
import { redirect } from "next/navigation";

export default function AdminDataIndexPage(): never {
  redirect("/admin/data/sources/");
}
