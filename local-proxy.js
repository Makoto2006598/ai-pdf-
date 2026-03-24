#!/usr/bin/env node
/**
 * 本地模型代理服务器
 * 用于在 MacBook Air M4 上通过 Ollama 运行本地模型，替代 Cloudflare Worker
 *
 * 使用方法：
 *   node local-proxy.js
 *
 * 默认端口：8787
 * Ollama 地址：http://localhost:11434
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const CONFIG = {
  port: parseInt(process.env.PORT || "8787"),
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  model: process.env.OLLAMA_MODEL || "qwen2.5:14b",
  // 静态文件目录（相对于本文件）
  staticDir: path.join(__dirname, "notes-pdf", "dist"),
  // 原始 Worker URL（在 JS 中替换掉）
  originalProxyUrl:
    "https://notes-ai-proxy.notetopdf.workers.dev/api/convert",
};

// ─── 系统提示词 ───────────────────────────────────────────────────────────────

const PROMPTS = {
  convert: (options = {}) => {
    const detail = options.detail || "medium"; // detailed / medium / concise
    const emphasisBox = options.emphasisBox !== false;
    const showExamples = options.showExamples !== false;
    const formulaStyle = options.formulaStyle || "display"; // display / inline

    const detailMap = {
      detailed: "尽量详细，展开每个知识点，加入推导步骤",
      medium: "适中详细，保留核心推导，省略繁琐步骤",
      concise: "简洁扼要，只保留结论和关键公式",
    };

    return `你是一位专业的理工科笔记排版助手。请将用户的笔记原文转换为结构清晰、排版精美的 HTML 格式笔记。

## 输出要求

1. **格式**：输出纯 HTML 片段（不含 <html>/<head>/<body> 标签），使用内联样式
2. **数学公式**：使用 LaTeX 语法，行内公式用 $...$ ，独立公式用 $$...$$ （后端会用 KaTeX 渲染）
3. **结构**：用 <h2>/<h3> 划分章节，<p> 写正文，<ul>/<ol> 写列表
4. **详细程度**：${detailMap[detail] || detailMap.medium}
${
  emphasisBox
    ? `5. **重点框**：对关键定理/公式用以下样式包裹：
   <div style="border-left:4px solid #3b82f6;background:#eff6ff;padding:12px 16px;margin:12px 0;border-radius:0 8px 8px 0">
     <strong>重点</strong>：...内容...
   </div>`
    : ""
}
${
  showExamples
    ? `6. **例题**：若笔记中有例题，用以下样式：
   <div style="background:#f0fdf4;border:1px solid #86efac;padding:12px 16px;margin:12px 0;border-radius:8px">
     <strong>例题</strong>：...题目...<br><strong>解</strong>：...解答...
   </div>`
    : ""
}
${formulaStyle === "display" ? "7. **独立公式**：重要公式单独一行使用 $$...$$" : "7. **公式**：公式尽量使用行内 $...$"}

## 注意
- 保持原文的所有数学内容，不得遗漏公式
- 不要输出 markdown，只输出 HTML
- 不要加任何说明文字，直接输出 HTML 内容`;
  },

  summarize: (options = {}) => {
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
输出纯 HTML 片段（不含 <html>/<head>/<body>），使用内联样式。
- 数学公式使用 LaTeX：行内 $...$，独立 $$...$$
- 用 <h2>/<h3> 划分模块，<ul>/<li> 列举要点
- 重点公式用蓝色左边框框住：
  <div style="border-left:4px solid #3b82f6;background:#eff6ff;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0">公式内容</div>

## 注意
- 只输出 HTML，不要输出 markdown 或说明文字
- 保持所有数学公式的 LaTeX 格式`;
  },
};

// ─── Ollama 调用 ──────────────────────────────────────────────────────────────

function callOllama(systemPrompt, userText, model) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      stream: false,
    });

    const url = new URL(`${CONFIG.ollamaUrl}/v1/chat/completions`);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const proto = url.protocol === "https:" ? https : http;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error));
          const content = json.choices?.[0]?.message?.content;
          if (!content) return reject(new Error("Ollama 返回了空响应"));
          resolve(content);
        } catch (e) {
          reject(new Error(`Ollama 响应解析失败：${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", (e) =>
      reject(new Error(`无法连接 Ollama（${CONFIG.ollamaUrl}）：${e.message}`))
    );
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("Ollama 请求超时（120s），请尝试更小的模型"));
    });
    req.write(body);
    req.end();
  });
}

// ─── 请求处理 ─────────────────────────────────────────────────────────────────

async function handleApiConvert(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  await new Promise((r) => req.on("end", r));

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { error: "请求体 JSON 格式错误" });
  }

  const { text, type = "convert", options = {} } = payload;
  const model = payload.model_override || CONFIG.model;

  if (!text || typeof text !== "string") {
    return sendJson(res, 400, { error: "缺少 text 字段" });
  }

  console.log(
    `[${new Date().toLocaleTimeString()}] 请求类型：${type}，模型：${model}，文本长度：${text.length}`
  );

  try {
    const systemPrompt =
      type === "summarize"
        ? PROMPTS.summarize(options)
        : PROMPTS.convert(options);

    const result = await callOllama(systemPrompt, text, model);

    // 清理模型可能输出的 markdown 代码块
    const html = result
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    console.log(
      `[${new Date().toLocaleTimeString()}] 完成，输出长度：${html.length}`
    );
    sendJson(res, 200, { html });
  } catch (err) {
    console.error(`[错误] ${err.message}`);
    sendJson(res, 500, { error: err.message });
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

// ─── 静态文件服务 ─────────────────────────────────────────────────────────────

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  const filePath = path.join(CONFIG.staticDir, urlPath);

  // 防止路径穿越
  if (!filePath.startsWith(CONFIG.staticDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      const indexPath = path.join(CONFIG.staticDir, "index.html");
      fs.readFile(indexPath, (e2, indexData) => {
        if (e2) {
          res.writeHead(404);
          return res.end("Not Found");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    // 动态替换 JS 中的 PROXY_URL，指向本地服务器
    if (ext === ".js") {
      const localUrl = `http://localhost:${CONFIG.port}/api/convert`;
      const patched = data
        .toString("utf8")
        .replace(
          JSON.stringify(CONFIG.originalProxyUrl),
          JSON.stringify(localUrl)
        );
      res.writeHead(200, { "Content-Type": contentType });
      return res.end(patched, "utf8");
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

// ─── 主服务器 ─────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method === "POST" && req.url.startsWith("/api/convert")) {
    return handleApiConvert(req, res);
  }

  if (req.method === "GET") {
    return serveStatic(req, res);
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(CONFIG.port, "127.0.0.1", () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║          AI 笔记转 PDF · 本地模型代理服务器              ║
╠══════════════════════════════════════════════════════════╣
║  前端地址：http://localhost:${CONFIG.port}                       ║
║  API 端点：http://localhost:${CONFIG.port}/api/convert           ║
║  Ollama：  ${CONFIG.ollamaUrl.padEnd(46)}║
║  当前模型：${CONFIG.model.padEnd(46)}║
╚══════════════════════════════════════════════════════════╝

切换模型：OLLAMA_MODEL=qwen2.5:14b node local-proxy.js
切换端口：PORT=3000 node local-proxy.js
`);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`❌ 端口 ${CONFIG.port} 已被占用，请换一个端口：`);
    console.error(`   PORT=8788 node local-proxy.js`);
  } else {
    console.error("服务器错误：", e);
  }
  process.exit(1);
});
