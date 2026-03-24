/**
 * Cloudflare Worker — AI 笔记转 PDF 代理
 *
 * 支持的 AI 提供商：
 *   - groq    : Groq API（默认，免费额度充足）
 *   - ollama  : 本地 Ollama（需在 wrangler.toml 配置 OLLAMA_URL）
 *
 * 环境变量（通过 wrangler secret put 设置）：
 *   GROQ_API_KEY   : Groq API Key（gsk_...）
 *   OLLAMA_URL     : Ollama 地址，如 http://192.168.1.100:11434（本地部署时用）
 *
 * KV 命名空间（可选，用于限流）：
 *   RATE_LIMIT_KV
 */

const RATE_LIMIT = {
  maxRequests: 20,
  windowSecs: 3600,
};

// ─── 系统提示词 ───────────────────────────────────────────────────────────────

function buildConvertPrompt(options = {}) {
  const detail = options.detail || "medium";
  const emphasisBox = options.emphasisBox !== false;
  const showExamples = options.showExamples !== false;
  const formulaStyle = options.formulaStyle || "display";

  const detailMap = {
    detailed: "尽量详细，展开每个知识点，加入推导步骤",
    medium: "适中详细，保留核心推导，省略繁琐步骤",
    concise: "简洁扼要，只保留结论和关键公式",
  };

  return `你是一位专业的理工科笔记排版助手。请将用户的笔记原文转换为结构清晰、排版精美的 HTML 格式笔记。

## 输出要求

1. **格式**：输出纯 HTML 片段（不含 <html>/<head>/<body> 标签），使用内联样式
2. **数学公式**：使用 LaTeX 语法，行内公式用 $...$，独立公式用 $$...$$
3. **结构**：用 <h2>/<h3> 划分章节，<p> 写正文，<ul>/<ol> 写列表
4. **详细程度**：${detailMap[detail] || detailMap.medium}
${
  emphasisBox
    ? `5. **重点框**：对关键定理/公式用以下样式包裹：
   <div style="border-left:4px solid #3b82f6;background:#eff6ff;padding:12px 16px;margin:12px 0;border-radius:0 8px 8px 0"><strong>重点</strong>：...内容...</div>`
    : ""
}
${
  showExamples
    ? `6. **例题**：若笔记中有例题，用以下样式：
   <div style="background:#f0fdf4;border:1px solid #86efac;padding:12px 16px;margin:12px 0;border-radius:8px"><strong>例题</strong>：...题目...<br><strong>解</strong>：...解答...</div>`
    : ""
}
${formulaStyle === "display" ? "7. 重要公式单独一行使用 $$...$$" : "7. 公式尽量使用行内 $...$"}

## 注意
- 保持原文的所有数学内容，不得遗漏公式
- 不要输出 markdown，只输出 HTML
- 不要加任何说明文字，直接输出 HTML 内容`;
}

function buildSummarizePrompt(options = {}) {
  const types = options.types || ["知识点提炼"];
  const detail = options.detail || "medium";

  const detailMap = {
    detailed: "详细，包含推导和解释",
    medium: "适中，保留核心内容",
    concise: "简洁，只列要点",
  };

  return `你是一位专业的理工科教材总结助手。请根据提供的教材/讲义文本，生成结构化总结。

## 总结类型
请生成以下类型的总结：${types.join("、")}

## 详细程度
${detailMap[detail] || detailMap.medium}

## 输出格式
输出纯 HTML 片段，使用内联样式。数学公式使用 LaTeX：行内 $...$，独立 $$...$$。
重点公式用蓝色左边框：
<div style="border-left:4px solid #3b82f6;background:#eff6ff;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0">公式内容</div>

只输出 HTML，不要输出 markdown 或说明文字。`;
}

// ─── 限流 ─────────────────────────────────────────────────────────────────────

async function checkRateLimit(ip, kv) {
  if (!kv) return true;
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT.windowSecs;

  let record;
  try {
    record = JSON.parse((await kv.get(key)) || "null");
  } catch {
    record = null;
  }

  if (!record || record.windowStart < windowStart) {
    record = { windowStart: now, count: 1 };
  } else {
    record.count += 1;
  }

  if (record.count > RATE_LIMIT.maxRequests) return false;

  await kv.put(key, JSON.stringify(record), {
    expirationTtl: RATE_LIMIT.windowSecs * 2,
  });
  return true;
}

// ─── Provider 调用 ────────────────────────────────────────────────────────────

async function callGroq(systemPrompt, userText, model, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      max_tokens: 8192,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API 错误 (${response.status}): ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callOllama(systemPrompt, userText, model, ollamaUrl) {
  const url = `${ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama 错误 (${response.status}): ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Worker 主入口 ────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST" || url.pathname !== "/api/convert") {
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    }

    // 限流检查
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";
    const allowed = await checkRateLimit(ip, env.RATE_LIMIT_KV);
    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: `请求过于频繁，每小时最多 ${RATE_LIMIT.maxRequests} 次`,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "请求体 JSON 格式错误" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { provider = "groq", model, text, type = "convert", options = {} } = payload;

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "缺少 text 字段" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt =
      type === "summarize"
        ? buildSummarizePrompt(options)
        : buildConvertPrompt(options);

    try {
      let result;

      if (provider === "ollama") {
        const ollamaUrl = env.OLLAMA_URL;
        if (!ollamaUrl) throw new Error("未配置 OLLAMA_URL 环境变量");
        result = await callOllama(systemPrompt, text, model || "qwen2.5:14b", ollamaUrl);
      } else {
        // 默认 groq
        const apiKey = env.GROQ_API_KEY;
        if (!apiKey) throw new Error("未配置 GROQ_API_KEY 环境变量");
        result = await callGroq(systemPrompt, text, model, apiKey);
      }

      // 清理 markdown 代码块
      const html = result
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      return new Response(JSON.stringify({ html }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
