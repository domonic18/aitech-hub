-- M27 批⑦:content_media.sha1 唯一约束(封并发同字节转存竞态——查后插无约束
-- 时同一封面并发转存产出重复行,同 ext 撞 path 唯一键的另一路直接报「上传错误」)。
-- 建索引前先清历史竞态存量(同 sha1 多行,保留最早一条;语义与 uploadMedia 侧
-- mergeDupeGroup 一致:引用/封面改指 keeper,同文已引两份的引用行删除,副本软删
-- 入回收站,物理文件留待 audit 清退)。软删行同受唯一约束——重传经 uploadMedia
-- 复活分支,不允许二次建行(路径全站唯一契约)。

-- 1) keeper = 每组最早(createdAt asc, id asc,与 mergeDupeGroup 同序)
CREATE TEMP TABLE _media_dupe_keepers ON COMMIT DROP AS
SELECT m.sha1, m.id AS keeper_id, m.path AS keeper_path
FROM content_media m
JOIN (
  SELECT sha1, MIN(id) AS keeper_id
  FROM content_media
  WHERE sha1 IS NOT NULL AND deleted_at IS NULL
  GROUP BY sha1
  HAVING COUNT(*) > 1
) d ON d.keeper_id = m.id;

-- 2) 正文引用改指 keeper;同文已同时引用两份的引用行删除(防 (media_path, post_id) 主键冲突)
DELETE FROM content_media_ref r
USING content_media dup, _media_dupe_keepers k
WHERE r.media_path = dup.path
  AND dup.sha1 = k.sha1
  AND dup.id <> k.keeper_id
  AND EXISTS (
    SELECT 1 FROM content_media_ref kref
    WHERE kref.media_path = k.keeper_path AND kref.post_id = r.post_id
  );

UPDATE content_media_ref r
SET media_path = k.keeper_path
FROM content_media dup, _media_dupe_keepers k
WHERE r.media_path = dup.path
  AND dup.sha1 = k.sha1
  AND dup.id <> k.keeper_id;

-- 3) 封面改指 keeper
UPDATE content_post p
SET cover_path = k.keeper_path
FROM content_media dup, _media_dupe_keepers k
WHERE p.cover_path = dup.path
  AND dup.sha1 = k.sha1
  AND dup.id <> k.keeper_id;

-- 4) 副本软删入回收站(active/orphan 等在用态一律置 deleted;deleted_at 已设的跳过)
UPDATE content_media dup
SET status = 'deleted', deleted_at = NOW()
FROM _media_dupe_keepers k
WHERE dup.sha1 = k.sha1
  AND dup.id <> k.keeper_id
  AND dup.deleted_at IS NULL;

-- 5) 未软删行 sha1 唯一(partial unique;Prisma schema 不表达,后续 migrate diff
-- 会视其为多余索引——同 checkpointer 外部表,部署纪律走 migrate deploy 不受影响)。
-- 全列唯一与回收站语义互斥(merge 副本软删留 trash 7 天,同 sha1 双行合法共存),
-- 竞态封堵面 = 并发 create 双双未软删,正是产出重复行的窗口
CREATE UNIQUE INDEX "uq_content_media_sha1" ON "content_media"("sha1") WHERE deleted_at IS NULL;
