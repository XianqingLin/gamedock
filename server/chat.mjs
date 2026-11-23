/**
 * 平台聊天(当前仅 AI 助手「小舟AI」,好友间聊天不在范围)。
 * 消息记录:{ id, userId, peerId, role:'user'|'assistant', content, createdAt }
 *
 * AI 回复走与厂商无关的通用 API:OpenAI 兼容的 POST {baseUrl}/chat/completions,
 * 配置来自 env.ai = { baseUrl, apiKey, model }(worker.mjs 组装;密钥经 secret 注入)。
 * 未配置或调用失败时明确报错,不伪造回复。
 */

export const AI_ASSISTANT = { id: 'ai-xiaozhou', username: '小舟AI', avatar: 'av0' };

const CONTENT_MAX = 2000;
/** 返回给前端的历史条数上限。 */
const HISTORY_LIMIT = 100;
/** 送入 AI 请求的最近消息条数。 */
const AI_CONTEXT_LIMIT = 20;

const SYSTEM_PROMPT =
  '你是 GameDock 平台的 AI 助手「小舟AI」。GameDock 是一个网页游戏平台,提供游戏库浏览、' +
  '账号(用户名密码注册登录)、好友社交(通过用户 ID 搜索添加好友)和平台存档。' +
  '用简体中文简短、友好地回答,帮助用户使用平台功能;不确定的信息不要编造,可以引导用户自行查看页面。';

const fail = (error) => ({ ok: false, error });

/** AI 环节失败的错误码:调用方据此返回 5xx(用户消息已落库),与入参校验错误(400)区分。 */
const failAi = (code, error) => ({ ok: false, code, error });

function peerGuard(peerId) {
  if (peerId === AI_ASSISTANT.id) return null;
  return fail('会话不存在');
}

/** 聊天历史(按时间正序,最多 HISTORY_LIMIT 条)。 */
export async function listChatMessages(store, userId, peerId) {
  const invalid = peerGuard(peerId);
  if (invalid) return invalid;
  return { ok: true, messages: await store.listChatMessages(userId, peerId, HISTORY_LIMIT) };
}

/**
 * 发送消息:先落库用户消息,再请求 AI 回复并落库;
 * 回复失败时用户消息保留(历史里可见),由调用方把错误文案展示给用户。
 */
export async function sendChatMessage(store, userId, peerId, content, ai) {
  const invalid = peerGuard(peerId);
  if (invalid) return invalid;
  if (typeof content !== 'string' || !content.trim()) return fail('消息不能为空');
  const text = content.trim();
  if (text.length > CONTENT_MAX) return fail(`消息过长,最多 ${CONTENT_MAX} 字`);

  const userMessage = {
    id: crypto.randomUUID(),
    userId,
    peerId,
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  };
  await store.insertChatMessage(userMessage);

  const recent = await store.listChatMessages(userId, peerId, AI_CONTEXT_LIMIT + 1);
  const prior = recent.filter((m) => m.id !== userMessage.id).slice(-AI_CONTEXT_LIMIT);
  const reply = await requestAiReply(ai, [
    ...prior.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text },
  ]);
  if (!reply.ok) return reply;

  const assistantMessage = {
    id: crypto.randomUUID(),
    userId,
    peerId,
    role: 'assistant',
    content: reply.content,
    createdAt: new Date().toISOString(),
  };
  await store.insertChatMessage(assistantMessage);
  return { ok: true, messages: [userMessage, assistantMessage] };
}

/** 调用通用 AI API(OpenAI 兼容),返回 {ok, content} 或 {ok:false, code, error}。 */
async function requestAiReply(ai, messages) {
  if (!ai?.baseUrl || !ai?.apiKey || !ai?.model) {
    return failAi('ai_unconfigured', 'AI 服务未配置,暂时无法回复');
  }

  let response;
  try {
    response = await fetch(`${ai.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
    });
  } catch {
    return failAi('ai_unavailable', 'AI 服务暂时不可用,请稍后重试');
  }

  if (!response.ok) return failAi('ai_unavailable', 'AI 服务暂时不可用,请稍后重试');

  let data;
  try {
    data = await response.json();
  } catch {
    return failAi('ai_broken', 'AI 服务响应异常,请稍后重试');
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return failAi('ai_broken', 'AI 服务响应异常,请稍后重试');
  }
  return { ok: true, content: content.trim() };
}
