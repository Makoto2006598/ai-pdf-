import { useState, useRef, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// ⚙️  部署配置
// ═══════════════════════════════════════════════════════════════════════════════
const PROXY_URL = "https://notes-ai-proxy.notetopdf.workers.dev/api/convert";

// ═══════════════════════════════════════════════════════════════════════════════
// AI 提供商
// ═══════════════════════════════════════════════════════════════════════════════
const PROVIDERS = {
  local: {
    id: "local", name: "本地模型", flag: "🖥", color: "#22d3ee",
    models: [
      { id: "local", name: "本地 GGUF 模型" },
    ],
    defaultModel: "local",
    direct: true, // 直接调用，不经过 Cloudflare Worker
  },
  groq: {
    id: "groq", name: "Groq", flag: "⚡", color: "#f97316",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant",    name: "Llama 3.1 8B（快速）" },
    ],
    defaultModel: "llama-3.3-70b-versatile",
  },
  claude: {
    id: "claude", name: "Claude", flag: "🧠", color: "#a78bfa",
    models: [
      { id: "claude-sonnet-4-6",          name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5（快速）" },
    ],
    defaultModel: "claude-sonnet-4-6",
  },
  deepseek: {
    id: "deepseek", name: "DeepSeek", flag: "🔍", color: "#38bdf8",
    models: [
      { id: "deepseek-chat",     name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
    defaultModel: "deepseek-chat",
  },
  qwen: {
    id: "qwen", name: "通义", flag: "🌊", color: "#34d399",
    models: [
      { id: "qwen-max",   name: "Qwen Max" },
      { id: "qwen-plus",  name: "Qwen Plus" },
      { id: "qwen-turbo", name: "Qwen Turbo（快速）" },
    ],
    defaultModel: "qwen-max",
  },
  glm: {
    id: "glm", name: "智谱", flag: "✦", color: "#fb7185",
    models: [
      { id: "glm-4",       name: "GLM-4" },
      { id: "glm-4-flash", name: "GLM-4 Flash（快速）" },
    ],
    defaultModel: "glm-4",
  },
  kimi: {
    id: "kimi", name: "Kimi", flag: "🌙", color: "#fbbf24",
    models: [
      { id: "moonshot-v1-32k",  name: "Moonshot 32k" },
      { id: "moonshot-v1-128k", name: "Moonshot 128k" },
    ],
    defaultModel: "moonshot-v1-32k",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 学科模板
// ═══════════════════════════════════════════════════════════════════════════════
const DEMO_TEMPLATES = {
  physics: {
    label: "🔭 大学物理", printTitle: "大学物理笔记",
    text: `在大学物理里，运动学研究的其实就是"函数关系"。位矢 \\vec{r}、速度 \\vec{v}、加速度 \\vec{a} 是三个互相嵌套的函数。
第一类问题：求导下坡路（已知位置求速度、加速度）
这是"顺着推"。只要你手里有质点的运动方程，你就掌握了它的一切。
1. 数学逻辑
 * 第一层： \\vec{v} = \\frac{d\\vec{r}}{dt} （位矢的一阶导数）
 * 第二层： \\vec{a} = \\frac{d\\vec{v}}{dt} = \\frac{d^2\\vec{r}}{dt^2} （位矢的二阶导数）
2. 分量拆解套路
合成时别忘了用勾股定理：v = \\sqrt{v_x^2 + v_y^2}。`,
  },
  math: {
    label: "📐 高等数学", printTitle: "高等数学笔记",
    text: `微积分核心定理：牛顿-莱布尼茨公式
若 F(x) 是 f(x) 在 [a,b] 上的原函数，则 \\int_a^b f(x)dx = F(b) - F(a)。
常用积分公式：
 * \\int x^n dx = \\frac{x^{n+1}}{n+1} + C （n \\neq -1）
 * \\int e^x dx = e^x + C
 * \\int \\sin x\\, dx = -\\cos x + C
易错点：换元法别忘了换积分上下限！`,
  },
  chemistry: {
    label: "⚗️ 物理化学", printTitle: "物理化学笔记",
    text: `热力学第一定律：能量守恒
公式：\\Delta U = Q + W
等压过程中，焓变 \\Delta H = Q_p，这是实验室最常用的条件。
吉布斯自由能：\\Delta G = \\Delta H - T\\Delta S，\\Delta G < 0 时反应自发进行。`,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 外部资源
// ═══════════════════════════════════════════════════════════════════════════════
const KATEX_CSS    = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css";
const KATEX_JS     = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js";
const KATEX_AUTO   = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js";
const DOMPURIFY_JS = "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.5/purify.min.js";
const PDFJS_JS     = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src;
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
function loadLink(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
  document.head.appendChild(l);
}

// ─── PDF 文字提取 ─────────────────────────────────────────────────────────────
async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error("PDF 解析器尚未加载，请稍后重试");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 80); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    fullText += `\n[第${i}页]\n${pageText}`;
  }
  return { text: fullText.trim(), numPages: pdf.numPages };
}

// ─── API 调用 ─────────────────────────────────────────────────────────────────
async function callAI(providerId, modelId, text, type, options, signal, { localUrl, userApiKey } = {}) {
  const provider = PROVIDERS[providerId];
  const url = provider?.direct ? (localUrl || "http://127.0.0.1:8788/api/convert") : PROXY_URL;
  const headers = { "Content-Type": "application/json" };
  if (userApiKey) headers["X-User-Api-Key"] = userApiKey;
  let res;
  try {
    res = await fetch(url, {
      method: "POST", signal, headers,
      body: JSON.stringify({ provider: providerId, model: modelId, text, type, options }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(provider?.direct
      ? `无法连接到本地服务（${url}），请确认服务已启动`
      : "网络连接失败，请检查 PROXY_URL 是否填写正确");
  }
  const raw = await res.text();
  if (!raw) throw new Error(`服务器返回了空响应（${res.status}），请检查 Worker 是否已部署`);
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`响应格式错误（${res.status}）：${raw.slice(0, 100)}`); }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data.html || data.text || "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// 样式常量
// ═══════════════════════════════════════════════════════════════════════════════
const PREVIEW_CSS = `
  .note-preview { font-family: 'Noto Serif SC', Georgia, serif; color: #1a1a2e; font-size: 14px; line-height: 1.85; }
  .note-preview h2.note-section { font-size: 15.5px; font-weight: 700; color: #fff; background: linear-gradient(90deg,#1565c0,#1976d2); padding: 7px 14px; border-radius: 6px; margin: 22px 0 10px; }
  .note-preview h3.note-subsection { font-size: 14px; font-weight: 700; color: #1565c0; border-left: 3px solid #1976d2; padding-left: 10px; margin: 16px 0 8px; }
  .note-preview .note-highlight { background: #e8f0fe; border-left: 4px solid #1976d2; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 10px 0; }
  .note-preview .note-warning   { background: #fff8e1; border-left: 4px solid #f9a825; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 10px 0; }
  .note-preview .note-example   { background: #e8f5e9; border-left: 4px solid #2e7d32; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 10px 0; }
  .note-preview .note-summary   { background: #fce4ec; border: 1px solid #e57373; padding: 12px 16px; border-radius: 8px; margin: 10px 0; }
  .note-preview .note-step      { display:flex; gap:12px; align-items:flex-start; margin:8px 0; }
  .note-preview .step-num       { background:#1976d2; color:#fff; border-radius:5px; padding:2px 8px; font-size:12px; font-weight:700; white-space:nowrap; margin-top:2px; font-family:sans-serif; }
  .note-preview .note-answer    { background:#e3f2fd; border:2px solid #1976d2; padding:12px 16px; border-radius:8px; margin:12px 0; text-align:center; }
  .note-preview .note-table     { width:100%; border-collapse:collapse; margin:12px 0; font-size:13px; }
  .note-preview .note-table th  { background:#1565c0; color:#fff; padding:8px 12px; text-align:center; }
  .note-preview .note-table td  { padding:8px 12px; border:1px solid #dde; text-align:center; }
  .note-preview .note-table tr:nth-child(even) td { background:#f0f4ff; }
  .note-preview ul { padding-left:20px; margin:8px 0; }
  .note-preview li { margin:5px 0; }
  .note-preview strong { color:#1a237e; }
  .note-preview p { margin:8px 0; }
  .katex-display { margin:12px 0 !important; overflow-x:auto; }
`;
const PRINT_CSS = `
@media print {
  body { margin:0; background:white; }
  .app-shell { display:none !important; }
  .print-area { display:block !important; padding:24mm 20mm; }
  .print-header { margin-bottom:12pt; border-bottom:1.5pt solid #1a3a6e; padding-bottom:8pt; }
  .print-header h1 { font-size:18pt; color:#1a3a6e; margin:0 0 2pt; font-family:'Georgia',serif; }
  .print-header p  { font-size:9pt; color:#666; margin:0; }
}
@media screen { .print-area { display:none; } }
`;

// ─── 按钮样式 ─────────────────────────────────────────────────────────────────
const btn = (variant, disabled = false) => ({
  padding: variant === "primary" ? "10px 26px" : "10px 18px",
  borderRadius: 8, border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13, fontFamily: "'Noto Sans SC',sans-serif",
  fontWeight: 600, transition: "all 0.15s", opacity: disabled ? 0.4 : 1,
  ...(variant === "primary"  ? { background:"linear-gradient(135deg,#1976d2,#1565c0)", color:"#fff", boxShadow:"0 4px 14px rgba(21,101,192,0.4)" }
   : variant === "success"  ? { background:"linear-gradient(135deg,#059669,#047857)", color:"#fff", boxShadow:"0 4px 14px rgba(5,150,105,0.35)" }
   : variant === "print"    ? { background:"rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.85)", border:"1px solid rgba(255,255,255,0.15)" }
   : variant === "orange"   ? { background:"linear-gradient(135deg,#ea580c,#c2410c)", color:"#fff", boxShadow:"0 4px 14px rgba(234,88,12,0.35)" }
   :                          { background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.6)", border:"1px solid rgba(255,255,255,0.1)" }),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 格式设置弹窗
// ═══════════════════════════════════════════════════════════════════════════════
function FormatDialog({ onConfirm, onCancel }) {
  const [opts, setOpts] = useState({ detail:"详细", highlights:true, examples:true, formulaStyle:"块级" });
  const toggle = (key) => setOpts(o => ({ ...o, [key]: !o[key] }));

  const Row = ({ label, children }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ color:"rgba(255,255,255,0.7)", fontSize:13, fontFamily:"'Noto Sans SC',sans-serif" }}>{label}</span>
      <div style={{ display:"flex", gap:6 }}>{children}</div>
    </div>
  );
  const RadioBtn = ({ val, current, onChange, label }) => (
    <button onClick={() => onChange(val)} style={{
      padding:"4px 12px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12,
      fontFamily:"'Noto Sans SC',sans-serif", fontWeight:600, transition:"all 0.15s",
      background: current === val ? "rgba(25,118,210,0.5)" : "rgba(255,255,255,0.06)",
      color: current === val ? "#fff" : "rgba(255,255,255,0.45)",
      boxShadow: current === val ? "0 0 0 1px rgba(25,118,210,0.6)" : "0 0 0 1px rgba(255,255,255,0.08)",
    }}>{label}</button>
  );
  const Toggle = ({ on, onToggle }) => (
    <div onClick={onToggle} style={{
      width:40, height:22, borderRadius:11, cursor:"pointer", position:"relative", transition:"background 0.2s",
      background: on ? "#1976d2" : "rgba(255,255,255,0.12)",
    }}>
      <div style={{ position:"absolute", top:3, left: on ? 21 : 3, width:16, height:16, borderRadius:8, background:"#fff", transition:"left 0.2s" }} />
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center" }}
         onClick={onCancel}>
      <div style={{ background:"linear-gradient(160deg,#0d1f3c,#1a2e50)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:16, padding:"28px 30px", width:400, maxWidth:"92vw", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }}
           onClick={e => e.stopPropagation()}>
        <div style={{ color:"#fff", fontWeight:700, fontSize:16, fontFamily:"'Noto Sans SC',sans-serif", marginBottom:6 }}>✨ 转换格式设置</div>
        <div style={{ color:"rgba(255,255,255,0.35)", fontSize:11, fontFamily:"sans-serif", marginBottom:18 }}>根据需求调整排版风格</div>

        <Row label="详细程度">
          <RadioBtn val="详细" current={opts.detail} onChange={v => setOpts(o=>({...o,detail:v}))} label="详细" />
          <RadioBtn val="简洁" current={opts.detail} onChange={v => setOpts(o=>({...o,detail:v}))} label="简洁" />
        </Row>
        <Row label="重点标注框">
          <Toggle on={opts.highlights} onToggle={() => toggle("highlights")} />
        </Row>
        <Row label="例题展示">
          <Toggle on={opts.examples} onToggle={() => toggle("examples")} />
        </Row>
        <Row label="公式样式">
          <RadioBtn val="块级" current={opts.formulaStyle} onChange={v => setOpts(o=>({...o,formulaStyle:v}))} label="独立成行" />
          <RadioBtn val="行内" current={opts.formulaStyle} onChange={v => setOpts(o=>({...o,formulaStyle:v}))} label="行内嵌入" />
        </Row>

        <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:22 }}>
          <button onClick={onCancel} style={btn("ghost")}>取消</button>
          <button onClick={() => onConfirm(opts)} style={btn("primary")}>开始转换 →</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主应用
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── 全局状态 ──
  const [activeTab, setActiveTab]         = useState("notes"); // "notes" | "pdf"
  const [katexReady, setKatexReady]       = useState(false);
  const [purifyReady, setPurifyReady]     = useState(false);
  const [pdfJsReady, setPdfJsReady]       = useState(false);

  // ── 本地模型 / 自带 Key ──
  const [localUrl, setLocalUrl]         = useState(() => localStorage.getItem("localUrl") || "http://127.0.0.1:8788/api/convert");
  const [userApiKey, setUserApiKey]     = useState(() => localStorage.getItem("userApiKey") || "");
  const [showKeyInput, setShowKeyInput] = useState(false);

  // ── 笔记转换状态 ──
  const [activeTemplate, setActiveTemplate] = useState("physics");
  const [input, setInput]               = useState(DEMO_TEMPLATES.physics.text);
  const [providerId, setProviderId]     = useState("groq");
  const [modelId, setModelId]           = useState(PROVIDERS.groq.defaultModel);
  const [html, setHtml]                 = useState("");
  const [printHtml, setPrintHtml]       = useState("");
  const [notesStatus, setNotesStatus]   = useState("idle");
  const [notesErr, setNotesErr]         = useState("");
  const [showFormatDialog, setShowFormatDialog] = useState(false);

  // ── PDF 总结状态 ──
  const [pdfFile, setPdfFile]           = useState(null);
  const [pdfInfo, setPdfInfo]           = useState(null); // { numPages, text }
  const [pdfLoading, setPdfLoading]     = useState(false);
  const [summaryOpts, setSummaryOpts]   = useState({ types:["知识点提炼","重点公式"], detail:"中等" });
  const [summaryStatus, setSummaryStatus] = useState("idle");
  const [summaryResult, setSummaryResult] = useState("");
  const [summaryErr, setSummaryErr]     = useState("");
  const [copied, setCopied]             = useState(false);
  const [dragOver, setDragOver]         = useState(false);

  const previewRef  = useRef(null);
  const abortRef    = useRef(null);
  const fileInputRef = useRef(null);

  // ── 初始化外部依赖 ──
  useEffect(() => {
    loadLink(KATEX_CSS);
    const addStyle = (id, css) => {
      if (!document.getElementById(id)) {
        const s = document.createElement("style"); s.id = id; s.textContent = css;
        document.head.appendChild(s);
      }
    };
    addStyle("note-preview-styles", PREVIEW_CSS);
    addStyle("note-print-styles",   PRINT_CSS);
    loadScript(DOMPURIFY_JS).then(() => setPurifyReady(true)).catch(() => {
      console.warn("DOMPurify 加载失败，HTML 将不经过净化直接渲染");
    });
    loadScript(KATEX_JS).then(() => loadScript(KATEX_AUTO)).then(() => setKatexReady(true)).catch(() => {
      console.warn("KaTeX 加载失败，数学公式将无法渲染");
    });
    loadScript(PDFJS_JS).then(() => setPdfJsReady(true)).catch(() => {
      setSummaryErr("PDF 解析器加载失败，请检查网络连接后刷新页面");
    });
    return () => abortRef.current?.abort();
  }, []);

  // ── HTML 净化辅助 ──
  const sanitize = useCallback((raw) => {
    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(raw, {
        ADD_TAGS: ["math","semantics","mrow","mi","mo","mn","mfrac","msup","msub","mtext","annotation"],
        ADD_ATTR: ["class","style","aria-hidden","focusable","role","xmlns"],
      });
    }
    return raw; // DOMPurify 未加载时回退（内容来自自有后端，风险可控）
  }, []);

  // ── KaTeX 渲染 ──
  useEffect(() => {
    if (!katexReady || !html || !previewRef.current) return;
    const el = previewRef.current;
    el.innerHTML = sanitize(html);
    window.renderMathInElement?.(el, {
      delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],
      throwOnError:false,
    });
    setPrintHtml(el.innerHTML);
  }, [html, katexReady, sanitize]);

  // ── 切换模板（自动清空预览）──
  const handleTemplate = useCallback((key) => {
    setActiveTemplate(key);
    setInput(DEMO_TEMPLATES[key].text);
    setHtml("");
    setPrintHtml("");
    setNotesStatus("idle");
    setNotesErr("");
  }, []);

  // ── 打开格式弹窗 ──
  const handleConvertClick = () => {
    if (!input.trim()) return;
    setShowFormatDialog(true);
  };

  // ── 确认格式后开始转换 ──
  const handleConvertConfirm = useCallback(async (formatOptions) => {
    setShowFormatDialog(false);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setNotesStatus("loading"); setNotesErr(""); setHtml("");
    try {
      const result = await callAI(providerId, modelId, input, "convert", formatOptions, abortRef.current.signal, { localUrl, userApiKey });
      setHtml(result); setNotesStatus("done");
    } catch (e) {
      if (e.name === "AbortError") return;
      setNotesErr(e.message); setNotesStatus("error");
    }
  }, [input, providerId, modelId]);

  // ── 上传 PDF ──
  const handlePdfFile = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") return;
    if (!pdfJsReady) { setSummaryErr("PDF 解析器正在加载，请稍后再试"); return; }
    setPdfFile(file);
    setPdfLoading(true);
    setSummaryResult(""); setSummaryErr(""); setSummaryStatus("idle");
    try {
      const info = await extractPdfText(file);
      setPdfInfo(info);
    } catch (e) {
      setSummaryErr("PDF 读取失败：" + e.message);
    } finally {
      setPdfLoading(false);
    }
  }, [pdfJsReady]);

  // ── 开始总结 ──
  const handleSummarize = useCallback(async () => {
    if (!pdfInfo?.text) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setSummaryStatus("loading"); setSummaryErr(""); setSummaryResult("");
    const textToSend = pdfInfo.text.slice(0, 12000);
    try {
      const result = await callAI(providerId, modelId, textToSend, "summarize", summaryOpts, abortRef.current.signal, { localUrl, userApiKey });
      setSummaryResult(result); setSummaryStatus("done");
    } catch (e) {
      if (e.name === "AbortError") return;
      setSummaryErr(e.message); setSummaryStatus("error");
    }
  }, [pdfInfo, providerId, modelId, summaryOpts]);

  // ── 发送到笔记转换 ──
  const sendToNotes = () => {
    if (!summaryResult) return;
    // 如果是 HTML 格式就直接用，否则放到输入框
    const isHtml = summaryResult.trim().startsWith("<");
    if (isHtml) {
      setHtml(summaryResult); setNotesStatus("done");
    } else {
      setInput(summaryResult); setNotesStatus("idle");
    }
    setActiveTab("notes");
  };

  // ── 复制文本 ──
  const handleCopy = () => {
    const plain = summaryResult.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const toggleSummaryType = (t) => {
    setSummaryOpts(o => ({
      ...o,
      types: o.types.includes(t) ? o.types.filter(x => x !== t) : [...o.types, t],
    }));
  };

  const currentProvider = PROVIDERS[providerId];
  const currentTemplate = DEMO_TEMPLATES[activeTemplate];
  const charCount = input.length;
  const isLong = charCount > 3000;
  const isTooLong = charCount > 6000;

  const SUMMARY_TYPES = ["知识点提炼", "重点公式", "章节大纲", "考点梳理"];

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;600;700&family=Noto+Serif+SC:wght@400;700&family=Fira+Code:wght@400&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        html,body { height:100%; background:#0a1628; }
        @keyframes spin   { to { transform:rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .preview-fade { animation:fadeIn 0.35s ease; }
        .tab-btn:hover   { background:rgba(255,255,255,0.1) !important; }
        .chip-btn:hover  { opacity:0.85; }
        .convert-btn:hover:not(:disabled) { transform:translateY(-1px); filter:brightness(1.1); }
        .clear-btn:hover { background:rgba(255,255,255,0.1) !important; }
        .cancel-btn:hover { background:rgba(255,80,80,0.22) !important; }
        .drop-zone:hover  { border-color:rgba(249,115,22,0.5) !important; background:rgba(249,115,22,0.04) !important; }
        textarea:focus { border-color:rgba(100,160,255,0.45) !important; }
        select:focus   { outline:none; border-color:rgba(100,160,255,0.45) !important; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.12); border-radius:2px; }
      `}</style>

      {/* 打印区 */}
      <div className="print-area">
        <div className="print-header">
          <h1>{currentTemplate.printTitle}</h1>
          <p>AI 模型：{currentProvider.name} · {modelId} · {new Date().toLocaleDateString("zh-CN")}</p>
        </div>
        <div className="note-preview" dangerouslySetInnerHTML={{ __html: printHtml }} />
      </div>

      {/* 格式弹窗 */}
      {showFormatDialog && (
        <FormatDialog
          onConfirm={handleConvertConfirm}
          onCancel={() => setShowFormatDialog(false)}
        />
      )}

      {/* 主界面 */}
      <div className="app-shell" style={{ height:"100vh", display:"flex", flexDirection:"column", overflow:"hidden", background:"linear-gradient(160deg,#0a1628 0%,#132040 50%,#0d2448 100%)", fontFamily:"'Noto Serif SC',Georgia,serif" }}>

        {/* ── 顶栏 ── */}
        <div style={{ padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, borderBottom:"1px solid rgba(255,255,255,0.08)", background:"rgba(8,16,36,0.5)", backdropFilter:"blur(10px)" }}>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, fontSize:16, background:"linear-gradient(135deg,#4fc3f7,#1565c0)", display:"flex", alignItems:"center", justifyContent:"center" }}>📐</div>
            <div>
              <div style={{ color:"#fff", fontWeight:700, fontSize:17, fontFamily:"'Noto Sans SC',sans-serif" }}>笔记 → PDF</div>
              <div style={{ color:"rgba(255,255,255,0.35)", fontSize:10, fontFamily:"sans-serif" }}>LaTeX · AI 智能排版</div>
            </div>
          </div>

          {/* 主 Tab */}
          <div style={{ display:"flex", gap:4, background:"rgba(255,255,255,0.05)", padding:4, borderRadius:10, border:"1px solid rgba(255,255,255,0.08)" }}>
            {[["notes","📝 笔记转换"],["pdf","📚 PDF 总结"]].map(([id,label]) => (
              <button key={id} className="tab-btn" onClick={() => setActiveTab(id)} style={{
                padding:"6px 16px", borderRadius:7, border:"none", cursor:"pointer",
                fontSize:12, fontFamily:"'Noto Sans SC',sans-serif", fontWeight:600, transition:"all 0.15s",
                background: activeTab===id ? "rgba(25,118,210,0.55)" : "transparent",
                color: activeTab===id ? "#fff" : "rgba(255,255,255,0.45)",
                boxShadow: activeTab===id ? "0 2px 8px rgba(21,101,192,0.3)" : "none",
              }}>{label}</button>
            ))}
          </div>

          {/* 右侧学科选择（仅笔记tab显示） */}
          <div style={{ display:"flex", alignItems:"center", gap:6, opacity: activeTab==="notes" ? 1 : 0, pointerEvents: activeTab==="notes" ? "auto" : "none", transition:"opacity 0.2s" }}>
            {Object.entries(DEMO_TEMPLATES).map(([key,tpl]) => (
              <button key={key} className="chip-btn" onClick={() => handleTemplate(key)} style={{
                padding:"4px 10px", borderRadius:6, cursor:"pointer", fontSize:11,
                fontFamily:"'Noto Sans SC',sans-serif", transition:"all 0.15s",
                background: activeTemplate===key ? "rgba(25,118,210,0.35)" : "rgba(255,255,255,0.05)",
                color: activeTemplate===key ? "#fff" : "rgba(255,255,255,0.45)",
                border:`1px solid ${activeTemplate===key ? "rgba(25,118,210,0.5)" : "rgba(255,255,255,0.1)"}`,
                fontWeight: activeTemplate===key ? 700 : 400,
              }}>{tpl.label}</button>
            ))}
          </div>
        </div>

        {/* ══════════ 笔记转换 Tab ══════════ */}
        {activeTab === "notes" && (
          <>
            {notesStatus === "error" && (
              <div style={{ margin:"8px 24px 0", padding:"8px 14px", flexShrink:0, background:"rgba(255,80,80,0.12)", border:"1px solid rgba(255,80,80,0.28)", borderRadius:8, color:"#ff8080", fontSize:13, fontFamily:"sans-serif" }}>⚠️ {notesErr}</div>
            )}

            {/* 模型选择条 */}
            <div style={{ padding:"8px 24px 0", flexShrink:0, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              {Object.values(PROVIDERS).map(p => {
                const active = providerId === p.id;
                return (
                  <button key={p.id} className="chip-btn" onClick={() => { setProviderId(p.id); setModelId(p.defaultModel); }} style={{
                    padding:"5px 13px", borderRadius:8, cursor:"pointer", fontSize:12,
                    fontFamily:"'Noto Sans SC',sans-serif", fontWeight:active?700:500, transition:"all 0.15s",
                    background: active ? `${p.color}28` : "rgba(255,255,255,0.04)",
                    color: active ? "#fff" : "rgba(255,255,255,0.45)",
                    border:`1px solid ${active ? p.color+"60" : "rgba(255,255,255,0.1)"}`,
                    display:"flex", alignItems:"center", gap:5,
                  }}>
                    <span>{p.flag}</span><span>{p.name}</span>
                  </button>
                );
              })}
              <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
                {!PROVIDERS[providerId]?.direct && (
                  <button onClick={() => setShowKeyInput(v => !v)} title="使用自己的 API Key" style={{
                    padding:"4px 10px", borderRadius:7, border:`1px solid ${userApiKey ? "rgba(34,211,238,0.5)" : "rgba(255,255,255,0.1)"}`,
                    background: userApiKey ? "rgba(34,211,238,0.1)" : "rgba(255,255,255,0.04)",
                    color: userApiKey ? "#22d3ee" : "rgba(255,255,255,0.35)", fontSize:11,
                    fontFamily:"'Noto Sans SC',sans-serif", cursor:"pointer",
                  }}>🔑 {userApiKey ? "已设置 Key" : "自带 Key"}</button>
                )}
                <span style={{ color:"rgba(255,255,255,0.3)", fontSize:11, fontFamily:"sans-serif" }}>模型：</span>
                <select value={modelId} onChange={e => setModelId(e.target.value)} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:7, color:"#e8eaf6", padding:"5px 10px", fontSize:12, fontFamily:"'Noto Sans SC',sans-serif", cursor:"pointer" }}>
                  {currentProvider.models.map(m => <option key={m.id} value={m.id} style={{ background:"#0d1f3c" }}>{m.name}</option>)}
                </select>
              </div>
            </div>

            {/* 本地模型 URL 输入 */}
            {PROVIDERS[providerId]?.direct && (
              <div style={{ padding:"6px 24px 0", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ color:"rgba(34,211,238,0.7)", fontSize:11, fontFamily:"sans-serif", whiteSpace:"nowrap" }}>🖥 服务地址：</span>
                <input value={localUrl} onChange={e => { setLocalUrl(e.target.value); localStorage.setItem("localUrl", e.target.value); }}
                  placeholder="http://127.0.0.1:8788/api/convert"
                  style={{ flex:1, background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.25)", borderRadius:7, color:"#e8eaf6", padding:"5px 10px", fontSize:12, fontFamily:"'Fira Code','Consolas',monospace", outline:"none" }}
                />
                <span style={{ color:"rgba(255,255,255,0.25)", fontSize:10, fontFamily:"sans-serif", whiteSpace:"nowrap" }}>本地服务需先启动</span>
              </div>
            )}

            {/* 自带 API Key 输入 */}
            {showKeyInput && !PROVIDERS[providerId]?.direct && (
              <div style={{ padding:"6px 24px 0", flexShrink:0, display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ color:"rgba(34,211,238,0.7)", fontSize:11, fontFamily:"sans-serif", whiteSpace:"nowrap" }}>🔑 API Key：</span>
                <input type="password" value={userApiKey} onChange={e => { setUserApiKey(e.target.value); localStorage.setItem("userApiKey", e.target.value); }}
                  placeholder={`填入 ${currentProvider.name} API Key，留空则使用服务端公共 Key`}
                  style={{ flex:1, background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.25)", borderRadius:7, color:"#e8eaf6", padding:"5px 10px", fontSize:12, fontFamily:"'Fira Code','Consolas',monospace", outline:"none" }}
                />
                {userApiKey && (
                  <button onClick={() => { setUserApiKey(""); localStorage.removeItem("userApiKey"); }} style={{ padding:"4px 8px", borderRadius:6, border:"1px solid rgba(255,80,80,0.3)", background:"rgba(255,80,80,0.08)", color:"#ff8080", fontSize:11, cursor:"pointer" }}>清除</button>
                )}
              </div>
            )}

            {/* 主编辑区 */}
            <div style={{ flex:1, display:"grid", gridTemplateColumns:"1fr 1px 1fr", padding:"12px 24px 0", overflow:"hidden", minHeight:0, gap:0 }}>
              {/* 左：输入 */}
              <div style={{ display:"flex", flexDirection:"column", gap:8, minHeight:0, paddingRight:18 }}>
                <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:6, flexShrink:0, fontFamily:"'Noto Sans SC',sans-serif" }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:"#4fc3f7" }} />
                  输入笔记原文
                </div>
                <textarea style={{ flex:1, minHeight:0, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, color:"#e8eaf6", padding:"16px", fontSize:13, lineHeight:1.75, fontFamily:"'Fira Code','Consolas',monospace", resize:"none", outline:"none", transition:"border 0.2s" }}
                  value={input} onChange={e => setInput(e.target.value)}
                  placeholder={"在此粘贴笔记，公式用 LaTeX 书写\n例：\\vec{v} = \\frac{d\\vec{r}}{dt}"}
                  spellCheck={false}
                />
                <div style={{ display:"flex", justifyContent:"space-between", flexShrink:0 }}>
                  <span style={{ color: isTooLong?"#ff8080":isLong?"#ffcc02":"rgba(255,255,255,0.2)", fontSize:11, fontFamily:"sans-serif", transition:"color 0.2s" }}>
                    {charCount.toLocaleString()} 字符{isTooLong&&" ⚠️ 内容过长，建议分段"}{!isTooLong&&isLong&&" · 较长，质量可能下降"}
                  </span>
                  <span style={{ color:"rgba(255,255,255,0.15)", fontSize:11, fontFamily:"sans-serif" }}>支持全部 LaTeX 命令</span>
                </div>
              </div>

              {/* 分割线 */}
              <div style={{ background:"rgba(255,255,255,0.07)", alignSelf:"stretch" }} />

              {/* 右：预览 */}
              <div style={{ display:"flex", flexDirection:"column", gap:8, minHeight:0, paddingLeft:18 }}>
                <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:6, flexShrink:0, fontFamily:"'Noto Sans SC',sans-serif" }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background: notesStatus==="done"?"#10b981":"#f59e0b" }} />
                  渲染预览
                  {notesStatus === "done" && <span style={{ color:"#10b981", fontSize:9, marginLeft:2 }}>✓ 完成</span>}
                </div>
                <div style={{ flex:1, background:"#fffdf7", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, overflowY:"auto", position:"relative", minHeight:0 }}>
                  {notesStatus === "loading" && (
                    <div style={{ position:"absolute", inset:0, background:"rgba(255,253,247,0.92)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", borderRadius:10, gap:12, zIndex:10 }}>
                      <div style={{ width:36, height:36, border:`3px solid #e0e0e0`, borderTop:`3px solid ${currentProvider.color}`, borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
                      <div style={{ color:"#1a3a6e", fontSize:13, fontFamily:"'Noto Sans SC',sans-serif" }}>AI 排版中…</div>
                      <button className="cancel-btn" onClick={() => { abortRef.current?.abort(); setNotesStatus("idle"); }} style={{ padding:"4px 14px", borderRadius:6, border:"1px solid rgba(255,80,80,0.35)", background:"rgba(255,80,80,0.08)", color:"#ff8080", fontSize:12, fontFamily:"'Noto Sans SC',sans-serif", cursor:"pointer" }}>取消</button>
                    </div>
                  )}
                  {!html && notesStatus !== "loading" && (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:200, color:"#bbb", gap:8 }}>
                      <div style={{ fontSize:40, opacity:0.2 }}>📄</div>
                      <div style={{ fontSize:12, fontFamily:"sans-serif", opacity:0.45 }}>点击「AI 转换」后选择格式，即可在此预览</div>
                    </div>
                  )}
                  <div style={{ padding:"22px 26px" }}>
                    <div ref={previewRef} className="note-preview preview-fade" />
                  </div>
                </div>
              </div>
            </div>

            {/* 底部操作 */}
            <div style={{ padding:"10px 24px", display:"flex", justifyContent:"center", alignItems:"center", gap:10, flexShrink:0, borderTop:"1px solid rgba(255,255,255,0.07)", background:"rgba(8,16,36,0.35)" }}>
              <button className="clear-btn" style={btn("ghost")} onClick={() => { setInput(""); setHtml(""); setPrintHtml(""); setNotesStatus("idle"); setNotesErr(""); }}>🗑 清空</button>
              <button className="convert-btn" style={btn("primary", notesStatus==="loading"||!input.trim())} onClick={handleConvertClick} disabled={notesStatus==="loading"||!input.trim()}>
                {notesStatus==="loading" ? "⏳ 转换中…" : "✨ AI 转换"}
              </button>
              <button className="convert-btn" style={btn("print", notesStatus!=="done")} onClick={() => window.print()} disabled={notesStatus!=="done"}>🖨 打印 / 保存 PDF</button>
            </div>
          </>
        )}

        {/* ══════════ PDF 总结 Tab ══════════ */}
        {activeTab === "pdf" && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", padding:"16px 24px", gap:14, minHeight:0 }}>

            {summaryErr && (
              <div style={{ padding:"8px 14px", background:"rgba(255,80,80,0.12)", border:"1px solid rgba(255,80,80,0.28)", borderRadius:8, color:"#ff8080", fontSize:13, fontFamily:"sans-serif", flexShrink:0 }}>⚠️ {summaryErr}</div>
            )}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, flex:1, minHeight:0 }}>

              {/* 左：上传 + 设置 */}
              <div style={{ display:"flex", flexDirection:"column", gap:12, minHeight:0 }}>

                {/* 上传区 */}
                <div className="drop-zone" onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);handlePdfFile(e.dataTransfer.files[0]);}} onClick={()=>fileInputRef.current?.click()} style={{ padding:"24px 20px", border:`2px dashed ${dragOver?"rgba(249,115,22,0.6)":"rgba(255,255,255,0.12)"}`, borderRadius:12, cursor:"pointer", textAlign:"center", background:dragOver?"rgba(249,115,22,0.05)":"rgba(255,255,255,0.02)", transition:"all 0.2s", flexShrink:0 }}>
                  <input ref={fileInputRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={e=>handlePdfFile(e.target.files[0])} />
                  {pdfLoading ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                      <div style={{ width:28, height:28, border:"3px solid #e0e0e0", borderTop:"3px solid #f97316", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
                      <span style={{ color:"rgba(255,255,255,0.4)", fontSize:12, fontFamily:"sans-serif" }}>解析 PDF 中…</span>
                    </div>
                  ) : pdfFile ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                      <div style={{ fontSize:28 }}>📖</div>
                      <div style={{ color:"#fff", fontSize:13, fontFamily:"'Noto Sans SC',sans-serif", fontWeight:600 }}>{pdfFile.name}</div>
                      <div style={{ color:"rgba(255,255,255,0.35)", fontSize:11, fontFamily:"sans-serif" }}>{pdfInfo?.numPages} 页 · 点击重新上传</div>
                    </div>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                      <div style={{ fontSize:32, opacity:0.4 }}>📄</div>
                      <div style={{ color:"rgba(255,255,255,0.5)", fontSize:13, fontFamily:"'Noto Sans SC',sans-serif" }}>拖拽或点击上传 PDF</div>
                      <div style={{ color:"rgba(255,255,255,0.25)", fontSize:11, fontFamily:"sans-serif" }}>支持教材、教辅、讲义（最多读取前 80 页）</div>
                    </div>
                  )}
                </div>

                {/* 总结选项 */}
                <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"16px 18px", display:"flex", flexDirection:"column", gap:14 }}>
                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'Noto Sans SC',sans-serif" }}>总结选项</div>

                  <div>
                    <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, fontFamily:"sans-serif", marginBottom:8 }}>提取内容（可多选）</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {SUMMARY_TYPES.map(t => {
                        const on = summaryOpts.types.includes(t);
                        return (
                          <button key={t} onClick={() => toggleSummaryType(t)} style={{ padding:"5px 12px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12, fontFamily:"'Noto Sans SC',sans-serif", fontWeight:600, transition:"all 0.15s",
                            background: on?"rgba(249,115,22,0.25)":"rgba(255,255,255,0.06)",
                            color: on?"#fbbf24":"rgba(255,255,255,0.4)",
                            boxShadow: on?"0 0 0 1px rgba(249,115,22,0.5)":"0 0 0 1px rgba(255,255,255,0.08)",
                          }}>{on?"✓ ":""}{t}</button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div style={{ color:"rgba(255,255,255,0.45)", fontSize:11, fontFamily:"sans-serif", marginBottom:8 }}>详细程度</div>
                    <div style={{ display:"flex", gap:6 }}>
                      {["详细","中等","简洁"].map(d => {
                        const on = summaryOpts.detail === d;
                        return (
                          <button key={d} onClick={() => setSummaryOpts(o=>({...o,detail:d}))} style={{ padding:"5px 14px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12, fontFamily:"'Noto Sans SC',sans-serif", fontWeight:600, transition:"all 0.15s",
                            background: on?"rgba(25,118,210,0.4)":"rgba(255,255,255,0.06)",
                            color: on?"#fff":"rgba(255,255,255,0.4)",
                            boxShadow: on?"0 0 0 1px rgba(25,118,210,0.6)":"0 0 0 1px rgba(255,255,255,0.08)",
                          }}>{d}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <button className="convert-btn" style={btn("orange", !pdfInfo||summaryStatus==="loading")} onClick={handleSummarize} disabled={!pdfInfo||summaryStatus==="loading"}>
                  {summaryStatus==="loading" ? "⏳ 总结中…" : "✨ 开始总结"}
                </button>
              </div>

              {/* 右：结果 */}
              <div style={{ display:"flex", flexDirection:"column", gap:8, minHeight:0 }}>
                <div style={{ color:"rgba(255,255,255,0.45)", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:6, flexShrink:0, fontFamily:"'Noto Sans SC',sans-serif" }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background: summaryStatus==="done"?"#10b981":"#f59e0b" }} />
                  总结结果
                  {summaryStatus==="done" && <span style={{ color:"#10b981", fontSize:9, marginLeft:2 }}>✓ 完成</span>}
                </div>

                <div style={{ flex:1, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, overflowY:"auto", position:"relative", minHeight:0 }}>
                  {summaryStatus === "loading" && (
                    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
                      <div style={{ width:36, height:36, border:"3px solid rgba(255,255,255,0.1)", borderTop:"3px solid #f97316", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
                      <div style={{ color:"rgba(255,255,255,0.4)", fontSize:13, fontFamily:"'Noto Sans SC',sans-serif" }}>AI 正在提取总结…</div>
                      <button className="cancel-btn" onClick={() => { abortRef.current?.abort(); setSummaryStatus("idle"); }} style={{ padding:"4px 14px", borderRadius:6, border:"1px solid rgba(255,80,80,0.35)", background:"rgba(255,80,80,0.08)", color:"#ff8080", fontSize:12, fontFamily:"'Noto Sans SC',sans-serif", cursor:"pointer" }}>取消</button>
                    </div>
                  )}
                  {!summaryResult && summaryStatus !== "loading" && (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:200, color:"#888", gap:8 }}>
                      <div style={{ fontSize:36, opacity:0.2 }}>📊</div>
                      <div style={{ fontSize:12, fontFamily:"sans-serif", opacity:0.45, textAlign:"center", padding:"0 24px" }}>上传 PDF 并选择总结选项，点击「开始总结」</div>
                    </div>
                  )}
                  {summaryResult && (
                    <div style={{ padding:"18px 20px", color:"rgba(255,255,255,0.8)", fontSize:13, lineHeight:1.85, fontFamily:"'Noto Serif SC',Georgia,serif", whiteSpace:"pre-wrap" }}
                         dangerouslySetInnerHTML={{ __html: sanitize(summaryResult.trim().startsWith("<") ? summaryResult : summaryResult.replace(/\n/g,"<br/>")) }} />
                  )}
                </div>

                {summaryStatus === "done" && (
                  <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                    <button className="convert-btn" style={btn("ghost")} onClick={handleCopy}>{copied?"✓ 已复制":"📋 复制文本"}</button>
                    <button className="convert-btn" style={{...btn("success"), flex:1}} onClick={sendToNotes}>📝 转为排版笔记 →</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
