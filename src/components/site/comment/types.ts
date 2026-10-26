/**
 * 评论区 client island 共享类型(M23):与 CommentDto(service 序列化层)
 * 同构的镜像声明——组件不 import service(零服务端依赖入 bundle)。
 */

/** 会话展示面(/api/auth/session data.user,登录判据 + composer 头像昵称) */
export interface SessionUser {
  sub: string;
  role: string;
  nickname: string | null;
  avatarPath: string | null;
}

export interface CommentNode {
  id: string;
  postId: string;
  parentId: string | null;
  authorName: string;
  content: string;
  status: string;
  /** WP 迁移评论(展示「旧站」徽标) */
  migrated: boolean;
  /** ISO 8601 */
  createdAt: string;
  likeCount: number;
  liked: boolean;
  /** 仅根节点携带(两级封顶,子节点无 replies) */
  replies?: CommentNode[];
}
