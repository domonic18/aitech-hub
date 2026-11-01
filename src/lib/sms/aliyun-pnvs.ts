/**
 * 阿里云号码认证服务(PNVS)「短信认证」适配(M65)。
 *
 * 选型背景:2025-06 起个人实名账号的传统短信签名被运营商停发(存量签名
 * 「可用-异常」且无法报备),PNVS 的短信认证对个人实名开放——无需企业资质 /
 * ICP 备案 / 自申请签名模板,签名与 5 个预置模板由阿里云预置,故本站只配
 * AccessKey + 签名名 + 模板编码。仅支持中国大陆手机号、仅验证码场景。
 *
 * 验证码由 PNVS 生成与校验(validTime/interval/duplicatePolicy 均服务端
 * 生效),本站不持有验证码明文;`returnVerifyCode` 恒为 false。
 */
import * as $OpenApi from "@alicloud/openapi-core";
import DypnsapiClient, {
  CheckSmsVerifyCodeRequest,
  SendSmsVerifyCodeRequest,
} from "@alicloud/dypnsapi20170525";

import {
  type CheckVerifyCodeResult,
  type SendVerifyCodeInput,
  type SendVerifyCodeResult,
  type SmsProvider,
  classifyProviderCode,
} from "./provider";

const ENDPOINT = "dypnsapi.aliyuncs.com";
const CONNECT_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 10_000;

/** SDK 抛错形态(AlibabaCloudError / ClientError 等):只取 code/message */
function readSdkError(e: unknown): { code: string | null; message: string } {
  if (typeof e === "object" && e !== null) {
    const rec = e as { code?: unknown; message?: unknown };
    const code = typeof rec.code === "string" ? rec.code : null;
    const message = typeof rec.message === "string" ? rec.message : String(e);
    return { code, message };
  }
  return { code: null, message: String(e) };
}

export interface AliyunPnvsOptions {
  accessKeyId: string;
  accessKeySecret: string;
}

export class AliyunPnvsProvider implements SmsProvider {
  private readonly client: DypnsapiClient;

  constructor(opts: AliyunPnvsOptions) {
    const config = new $OpenApi.$OpenApiUtil.Config({
      accessKeyId: opts.accessKeyId,
      accessKeySecret: opts.accessKeySecret,
    });
    config.endpoint = ENDPOINT;
    config.connectTimeout = CONNECT_TIMEOUT_MS;
    config.readTimeout = READ_TIMEOUT_MS;
    this.client = new DypnsapiClient(config);
  }

  async sendVerifyCode(input: SendVerifyCodeInput): Promise<SendVerifyCodeResult> {
    const validTimeSeconds = input.validTimeSeconds ?? 300;
    // 预置模板(100001-100005)的模板内容含两个变量:${code} 与 ${min}(有效期分钟)。
    // 只传 code 时阿里云回 isv.INVALID_PARAMETERS「请检查模板内容与模板参数是否匹配」
    // ——2026-10-31 调试台实证,正确取值 {"code":"##code##","min":"5"}。
    const templateParam =
      input.templateParam ??
      JSON.stringify({
        code: "##code##",
        min: String(Math.max(1, Math.round(validTimeSeconds / 60))),
      });
    try {
      const resp = await this.client.sendSmsVerifyCode(
        new SendSmsVerifyCodeRequest({
          phoneNumber: input.phone,
          signName: input.signName,
          templateCode: input.templateCode,
          templateParam,
          validTime: validTimeSeconds,
          interval: input.intervalSeconds ?? 60,
          codeLength: input.codeLength ?? 6,
          codeType: 1, // 纯数字
          duplicatePolicy: 1, // 新码覆盖旧码
          returnVerifyCode: false,
          ...(input.outId ? { outId: input.outId } : {}),
        }),
      );
      const body = resp.body;
      if (body?.success && body.code === "OK") {
        return {
          ok: true,
          bizId: body.model?.bizId ?? null,
          requestId: body.requestId ?? null,
        };
      }
      const code = body?.code ?? null;
      return {
        ok: false,
        reason: classifyProviderCode(code),
        code,
        message: body?.message ?? "短信服务返回失败",
      };
    } catch (e) {
      const { code, message } = readSdkError(e);
      return { ok: false, reason: classifyProviderCode(code), code, message };
    }
  }

  async checkVerifyCode(input: { phone: string; code: string }): Promise<CheckVerifyCodeResult> {
    try {
      const resp = await this.client.checkSmsVerifyCode(
        new CheckSmsVerifyCodeRequest({
          phoneNumber: input.phone,
          verifyCode: input.code,
          caseAuthPolicy: 1,
        }),
      );
      const body = resp.body;
      if (body?.success && body.code === "OK") {
        return body.model?.verifyResult === "PASS"
          ? { ok: true }
          : { ok: false, reason: "mismatch", code: body.code, message: "验证码不正确或已过期" };
      }
      const code = body?.code ?? null;
      return {
        ok: false,
        reason: classifyProviderCode(code),
        code,
        message: body?.message ?? "短信校验返回失败",
      };
    } catch (e) {
      const { code, message } = readSdkError(e);
      return { ok: false, reason: classifyProviderCode(code), code, message };
    }
  }
}
