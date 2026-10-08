/**
 * 用户账号状态常量(review P2 收敛):字面量唯一出处——同 ADMIN_ROLE
 * (auth/constants)、POST_STATUS_*(post-schema)、media 状态(media-schema)
 * 先例。零依赖,客户端组件可安全引用。pending_binding 为迁移态,管理接口
 * 不可手动设置;可设集仅 active|disabled(setUserStatus/zod 同源)。
 */
export const USER_STATUS_ACTIVE = "active";
export const USER_STATUS_PENDING_BINDING = "pending_binding";
export const USER_STATUS_DISABLED = "disabled";

/** 管理接口可设置的状态集(待绑定不可手动设) */
export const USER_STATUS_MUTABLE = [USER_STATUS_ACTIVE, USER_STATUS_DISABLED] as const;
export type UserMutableStatus = (typeof USER_STATUS_MUTABLE)[number];
