/**
 * 📌 笔记转换 API 代理 · Cloudflare Worker
 *
 * 功能：
 *  1. 代理前端对各 AI 的请求，Key 存在服务端，用户不可见
 *  2. 基于 IP 的滑动窗口限流（默认：每 IP 每小时 20 次）
 *  3. 统一错误处理与 CORS
 *
 * 环境变量（在 Cloudflare 面板 → Workers → Settings → Variables 里配置）：
 *  GROQ_API_KEY     = gsk_...        ← 免费，推荐首选
 *  CLAUDE_API_KEY   = sk-ant-...
 *  DEEPSEEK_API_KEY = sk-...
 *  QWEN_API_KEY     = sk-...
 *  GLM_API_KEY      = xxxxx.xxxxx
 *  KIMI_API_KEY     = sk-...
 *
 * KV 命名空间（用于限流，可选但推荐）：
 *  RATE_LIMIT_KV    → 绑定名称 RATE_LIMIT_KV
 */

// ─── 限流配置 ────────────────────────────────────────────────────────────────
const RATE_LIMIT = {
  maxRequests: 20,      // 每个 IP 最多请求次数
  windowSecs:  3600,    // 时间窗口（秒），3600 = 1 小时
};

// ─── 各提供商的 API 配置 ──────────────────────────────────────────────────────
const PROVIDER_CONFIG = {
  groq: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    format:   "openai",
    getKey:   (env) => env.GROQ_API_KEY,
  },
  claude: {
    endpoint: "https://api.anthropic.com/v1/messages",
    format:   "anthropic",
    getKey:   (env) => env.CLAUDE_API_KEY,
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    format:   "openai",
    getKey:   (env) => env.DEEPSEEK_API_KEY,
  },
  qwen: {
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    format:   "openai",
    getKey:   (env) => env.QWEN_API_KEY,
  },
  glm: {
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    format:   "openai",
    getKey:   (env) => env.GLM_API_KEY,
  },
  kimi: {
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    format:   "openai",
    getKey:   (env) => env.KIMI_API_KEY,
  },
};

const SYSTEM_PROMPT = `你是一位精通学科笔记排版的专家，擅长物理、数学、化学等理工科内容。
用户会发给你一段含有 LaTeX 公式的笔记文本（公式用 \\vec{}, \\frac{} 等 LaTeX 语法书写）。

你的任务：将笔记转换为结构清晰、视觉美观的 HTML 笔记。

输出格式规则（严格遵守）：
1. 只输出 HTML 片段（不要包含 <html><body> 等外层标签，不要包含 markdown 代码块标记）
2. 行内公式用 $...$ 包裹，块级公式用 $$...$$ 包裹
3. 使用以下 class 进行语义标注：
   - <h2 class="note-section"> 大章节标题
   - <h3 class="note-subsection"> 小节标题
   - <div class="note-highlight"> 重要概念框
   - <div class="note-warning"> 易错点警告框
   - <div class="note-example"> 例题框
   - <div class="note-summary"> 总结框
   - <div class="note-step"> 步骤（需含 <span class="step-num">步骤N</span>）
   - <div class="note-answer"> 最终答案（含 \\boxed{}）
   - <p> 普通段落，<ul><li> 列表，<strong> 强调词
4. 表格用 <table class="note-table"><thead><tbody> 结构
5. 不要输出任何解释，直接输出 HTML`;

// ─── CORS 头 ──────────────────────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ─── 限流检查 ─────────────────────────────────────────────────────────────────
async function checkRateLimit(ip, env) {
  // 没有绑定 KV 时跳过限流（开发阶段用）
  if (!env.RATE_LIMIT_KV) return { allowed: true };

  const key       = `rl:${ip}`;
  const nowSecs   = Math.floor(Date.now() / 1000);
  const windowKey = Math.floor(nowSecs / RATE_LIMIT.windowSecs); // 当前窗口编号
  const kvKey     = `${key}:${windowKey}`;

  // 取当前计数
  const raw   = await env.RATE_LIMIT_KV.get(kvKey);
  const count = raw ? parseInt(raw) : 0;

  if (count >= RATE_LIMIT.maxRequests) {
    const resetAt = (windowKey + 1) * RATE_LIMIT.windowSecs;
    return {
      allowed:   false,
      remaining: 0,
      resetIn:   resetAt - nowSecs,
    };
  }

  // 递增，TTL = 窗口时长 + 5s 缓冲
  await env.RATE_LIMIT_KV.put(kvKey, String(count + 1), {
    expirationTtl: RATE_LIMIT.windowSecs + 5,
  });

  return {
    allowed:   true,
    remaining: RATE_LIMIT.maxRequests - count - 1,
  };
}

// ─── 调用 AI API ──────────────────────────────────────────────────────────────
async function callAI(providerId, modelId, userText, env, userApiKey) {
  const cfg = PROVIDER_CONFIG[providerId];
  if (!cfg) throw { status: 400, message: `未知提供商：${providerId}` };

  const apiKey = userApiKey || cfg.getKey(env);
  if (!apiKey) throw { status: 503, message: `${providerId} API Key 未配置，请联系管理员或在前端填入自己的 Key` };

  let body, headers;

  if (cfg.format === "anthropic") {
    headers = {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    };
    body = JSON.stringify({
      model:      modelId,
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: "user", content: userText }],
    });
  } else {
    // OpenAI 兼容格式（DeepSeek / 通义 / GLM / Kimi）
    headers = {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    body = JSON.stringify({
      model:      modelId,
      max_tokens: 4096,
      messages:   [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userText },
      ],
    });
  }

  const resp = await fetch(cfg.endpoint, { method: "POST", headers, body });

  if (!resp.ok) {
    let detail = "";
    try { const d = await resp.json(); detail = d.error?.message || ""; } catch {}
    if (resp.status === 429) throw { status: 429, message: "AI 服务繁忙，请稍后重试" };
    if (resp.status === 401) throw { status: 401, message: `${providerId} API Key 无效` };
    if (resp.status === 402) throw { status: 402, message: `${providerId} 账户余额不足` };
    throw { status: resp.status, message: `AI 请求失败（${resp.status}）${detail ? "：" + detail : ""}` };
  }

  const data = await resp.json();
  let text = "";
  if (cfg.format === "anthropic") {
    text = data.content?.find(b => b.type === "text")?.text || "";
  } else {
    text = data.choices?.[0]?.message?.content || "";
  }

  // 清除部分模型可能返回的 markdown 代码块标记
  return text.replace(/^```html\n?/i, "").replace(/\n?```$/i, "").trim();
}

// ─── Worker 入口 ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    // 最外层兜底：确保任何情况都返回 JSON，不会出现空响应
    try {
      return await handleRequest(request, env);
    } catch (e) {
      console.error("Unhandled error:", e);
      return jsonResp({ error: "服务器内部错误，请稍后重试" }, 500);
    }
  },
};

async function handleRequest(request, env) {
    const url = new URL(request.url);

    // OPTIONS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 只接受 POST /api/convert
    if (url.pathname !== "/api/convert" || request.method !== "POST") {
      return jsonResp({ error: "Not Found" }, 404);
    }

    // ── 解析请求体 ──
    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResp({ error: "请求体必须是 JSON" }, 400);
    }

    const { provider, model, text } = payload;
    if (!provider || !model || !text?.trim()) {
      return jsonResp({ error: "缺少必填字段：provider / model / text" }, 400);
    }
    if (text.length > 8000) {
      return jsonResp({ error: "笔记内容超出长度限制（最多 8000 字符），请分段处理" }, 413);
    }

    // 读取用户自带的 API Key（可选）
    const userApiKey = request.headers.get("X-User-Api-Key") || "";

    // ── 限流检查（自带 Key 的用户不受限流）──
    const ip     = request.headers.get("CF-Connecting-IP") || "unknown";
    const rLimit = userApiKey ? { allowed: true, remaining: 999 } : await checkRateLimit(ip, env);
    if (!rLimit.allowed) {
      const mins = Math.ceil(rLimit.resetIn / 60);
      return jsonResp(
        { error: `请求过于频繁，请 ${mins} 分钟后再试（每小时限 ${RATE_LIMIT.maxRequests} 次）` },
        429
      );
    }

    // ── 调用 AI ──
    try {
      const html = await callAI(provider, model, text, env, userApiKey);
      return jsonResp({ html, remaining: rLimit.remaining });
    } catch (e) {
      const status  = typeof e.status === "number" ? e.status : 500;
      const message = typeof e.message === "string" ? e.message : "服务器内部错误，请稍后重试";
      return jsonResp({ error: message }, status);
    }
}
