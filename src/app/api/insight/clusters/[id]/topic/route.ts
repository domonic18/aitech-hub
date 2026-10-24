/** 洞察簇一键生成选题(M46 验收批,板终态 F25/F26):洞察详情「生成选题」
 * 后端——建题(簇 label/概括/关键词)+ 自动挂载簇内电报素材(权重降序封顶),
 * 免手动建题与逐条挂素材。仅会话通道(PAT 不得操纵创作,同 topics 口径)。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { createTopicFromCluster } from "@/lib/insight/topic-gen";
import { TopicError } from "@/lib/topics/errors";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not create topics from insight clusters";
const ID_RE = /^\d{1,10}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "簇 id 不合法");
  try {
    const r = await createTopicFromCluster(BigInt(id));
    return apiEnvelope(0, "created", {
      topic_id: r.topicId.toString(),
      title: r.title,
      mounted: r.mounted,
      scanned: r.scanned,
      admin_url: `/admin/studio/${r.topicId.toString()}`,
    });
  } catch (e) {
    if (e instanceof TopicError) {
      if (e.code === "not_found") return apiEnvelope(404, e.message);
      return apiEnvelope(400, e.message);
    }
    throw e;
  }
}
