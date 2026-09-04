import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import os from "os";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "20mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS = ["mp4", "mov", "webm", "m4v"];
const VECTOR_EXTS = ["eps", "ai", "cdr"];
const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...VECTOR_EXTS];

const TREND_CONTEXT = `
CURATED 2026 MICROSTOCK TREND SIGNALS.
Adobe Creative Trends: All the Feels, Connectioneering, Surreal Silliness, Local Flavor.
Current Shutterstock opportunity signals include AI education, AI classroom, AI evolution, coding screen,
football playground, printable art, matcha background, kawaii/cute, pencil/cartoon, school timetable,
teacher imagery and stylized waves.
These are opportunity signals only. Never force a trend into metadata when the uploaded media does not support it.
Never add brands, trademarks, celebrities, locations, events or unsupported concepts just because they trend.
`;

function cleanArray(values, max = 50) {
  if (!Array.isArray(values)) return [];
  return [...new Map(
    values.map(v => String(v ?? "").trim()).filter(Boolean).map(v => [v.toLowerCase(), v])
  ).values()].slice(0, max);
}

function parseJsonResponse(text) {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI menghasilkan response JSON yang tidak valid.");
  }
}

function formatApiError(err) {
  const msg = String(err?.message || err || "").trim();
  
  try {
    const jsonStart = msg.indexOf("{");
    if (jsonStart >= 0) {
      const parsed = JSON.parse(msg.slice(jsonStart));
      if (parsed.error?.message) {
        return formatApiError(new Error(parsed.error.message));
      }
    }
  } catch {}

  if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand")) {
    return "Server Gemini sedang sangat sibuk / High Demand (503). Silakan coba lagi beberapa saat lagi.";
  }
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota")) {
    return "Kuota / Limit gratis Gemini API Key telah habis (429). Silakan tunggu beberapa saat atau gunakan API Key lain.";
  }
  if (msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("api key")) {
    return "Gemini API Key tidak valid atau tidak memiliki akses.";
  }
  return msg.length > 180 ? `${msg.slice(0, 180)}...` : msg;
}

function normalizeMetadata(metadata) {
  metadata.shutterstock ||= {};
  metadata.adobe ||= {};
  metadata.visual_analysis ||= {};
  metadata.trend_analysis ||= {};
  metadata.quality_signals ||= {};

  for (const platform of ["shutterstock", "adobe"]) {
    metadata[platform].title = String(metadata[platform].title || "").trim();
    metadata[platform].description = String(metadata[platform].description || "").trim();
    metadata[platform].category = String(metadata[platform].category || "Illustrations").trim();
  }
  metadata.adobe.title = metadata.adobe.title.slice(0, 70);
  metadata.shutterstock.keywords = cleanArray(metadata.shutterstock.keywords, 50);
  metadata.adobe.keywords = cleanArray(metadata.adobe.keywords, 49);
  metadata.visual_analysis.visual_fingerprint = cleanArray(metadata.visual_analysis.visual_fingerprint, 12);
  metadata.trend_analysis.matched_trends = cleanArray(metadata.trend_analysis.matched_trends, 6);
  metadata.trend_analysis.supported_trend_keywords = cleanArray(metadata.trend_analysis.supported_trend_keywords, 15);
  const opportunity = String(metadata.trend_analysis.opportunity || "Low");
  metadata.trend_analysis.opportunity = ["High", "Medium", "Low"].includes(opportunity) ? opportunity : "Low";
  const match = Number(metadata.trend_analysis.match_percent);
  metadata.trend_analysis.match_percent = Number.isFinite(match) ? Math.max(0, Math.min(100, Math.round(match))) : 0;
  metadata.trend_analysis.reason = String(metadata.trend_analysis.reason || "").trim();
  return metadata;
}

function calculateQualitySignals(metadata, platform) {
  const d = metadata?.[platform] || {};
  const fp = cleanArray(metadata?.visual_analysis?.visual_fingerprint, 12);
  const title = String(d.title || '').trim();
  const description = String(d.description || '').trim();
  const keywords = cleanArray(d.keywords, 49);
  const category = String(d.category || '').trim();
  let visual = 0;
  if (String(metadata?.visual_analysis?.summary || '').trim()) visual += 8;
  if (fp.length >= 3) visual += 7; else if (fp.length) visual += 4;
  if (String(metadata?.visual_analysis?.subject || '').trim()) visual += 4;
  if (String(metadata?.visual_analysis?.composition || '').trim()) visual += 3;
  if (String(metadata?.visual_analysis?.style || '').trim()) visual += 3;
  visual = Math.min(25, visual);

  let titleQuality = 0;
  if (title) titleQuality += 8;
  if (platform === 'adobe' ? title.length <= 70 : title.length <= 200) titleQuality += 4;
  if (title.split(/\s+/).filter(Boolean).length >= 4) titleQuality += 4;
  if (!/^(beautiful|amazing|cool|nice|stock image|illustration|photo|vector)\b/i.test(title)) titleQuality += 4;
  titleQuality = Math.min(20, titleQuality);

  let descriptionQuality = 0;
  if (description) descriptionQuality += 7;
  if (description.length >= 80) descriptionQuality += 5;
  if (description.length >= 120) descriptionQuality += 3;
  if (description.split(/[.!?]+/).filter(x => x.trim()).length >= 2) descriptionQuality += 3;
  if (description.toLowerCase() !== title.toLowerCase()) descriptionQuality += 2;
  descriptionQuality = Math.min(20, descriptionQuality);

  let keywordRelevance = 0;
  if (keywords.length >= 7) keywordRelevance += 5; else if (keywords.length) keywordRelevance += 2;
  if (keywords.length >= 15) keywordRelevance += 4;
  if (keywords.length >= 25) keywordRelevance += 4;
  if (keywords.length >= 35) keywordRelevance += 3;
  if (category) keywordRelevance += 2;
  if (keywords.slice(0, 10).length >= 5) keywordRelevance += 2;
  keywordRelevance = Math.min(20, keywordRelevance);

  const diversity = keywords.length ? Math.round(new Set(keywords.map(x => x.toLowerCase())).size / keywords.length * 10) : 0;
  const match = Number(metadata?.trend_analysis?.match_percent);
  const trendOpportunity = Math.min(5, Math.round((Number.isFinite(match) ? match : 0) / 20));
  const total = Math.max(0, Math.min(100, visual + titleQuality + descriptionQuality + keywordRelevance + diversity + trendOpportunity));
  return { visual_relevance: visual, title_quality: titleQuality, description_quality: descriptionQuality, keyword_relevance: keywordRelevance, keyword_diversity: diversity, trend_opportunity: trendOpportunity, total };
}

function getExt(fileName) {
  return String(fileName || "").toLowerCase().split(".").pop();
}

function mediaPrompt(mediaType, ext) {
  if (mediaType === "video") return `
MEDIA TYPE: VIDEO.
Analyze the supplied video as moving stock footage. Focus on the visible subject, setting, action/movement,
shot/composition, camera perspective, lighting, mood and useful footage concepts. Do not invent details that are not visible.
Titles and descriptions should describe the actual footage, not a hypothetical still image.
`;
  if (mediaType === "vector") return `
MEDIA TYPE: VECTOR.
Treat the supplied artwork as vector/illustration content. Focus on the actual illustrated subject, shapes, style,
composition, colors, graphic elements and intended visual concept. Do not call it a photograph or live-action footage.
`;
  return `
MEDIA TYPE: IMAGE.
Analyze the supplied image as still stock artwork or photography. Focus on visible subjects, composition, style,
lighting, colors, materials and context. Do not invent unsupported facts.
`;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `${command} exited with code ${code}`)));
  });
}

async function rasterizeVector(buffer, originalName) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vmp-"));
  const source = path.join(tempDir, `source.${getExt(originalName)}`);
  const output = path.join(tempDir, "preview.png");
  await fs.writeFile(source, buffer);
  try {
    await runCommand("inkscape", [source, "--export-type=png", `--export-filename=${output}`, "--export-width=2400"]);
    const png = await fs.readFile(output);
    return { buffer: png, mimeType: "image/png", cleanup: () => fs.rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw new Error(`File vector ${getExt(originalName).toUpperCase()} tidak dapat dirasterisasi. Pastikan Inkscape terpasang dan file tidak rusak. Detail: ${error.message}`);
  }
}

function constructPrompt(mediaType, ext, avoidTitles, avoidDescriptions) {
  return `
You are the metadata engine for a professional microstock contributor.

${mediaPrompt(mediaType, ext)}

PRIMARY GOAL:
Create accurate, specific, commercially useful metadata for Shutterstock and Adobe Stock.

ACCURACY:
- Only describe what is visible or clearly supported by the supplied media.
- Never invent objects, people, demographics, locations, brands, logos, events or facts.
- Never use trademarks or brand names.
- Never keyword-stuff.
- Do not call something 3D, isolated, copy-space, realistic, cinematic, etc. unless supported.

UNIQUENESS:
Identify a visual fingerprint first: subject, distinctive detail, action, composition, style/material,
lighting, color relationship and context. Use it to make titles and descriptions specific.
Avoid repeating the sentence structure of previous results.

PREVIOUS TITLES FROM THIS SESSION:
${JSON.stringify(avoidTitles)}
PREVIOUS DESCRIPTIONS FROM THIS SESSION:
${JSON.stringify(avoidDescriptions)}

TITLE:
- English and natural.
- Specific to this media.
- Shutterstock: commercially useful and descriptive.
- Adobe Stock: under 70 characters.

DESCRIPTION:
- English, natural sentence(s), factual and visually grounded.
- Describe what a buyer actually sees.
- Do not simply expand the title.
- Avoid boilerplate and keyword stuffing.

KEYWORDS:
- Relevant to actual visible content.
- Strongest and most precise first (important: Adobe Stock prioritizes the top 10 keywords!).
- Use useful multi-word phrases where appropriate.
- No duplicates or near-duplicates.
- Adobe: maximum 49, strongest 10 first.
- Shutterstock: 7-50.

TREND INTELLIGENCE:
${TREND_CONTEXT}

Return ONLY valid JSON using exactly this structure:
{
  "visual_analysis": { "summary": "", "visual_fingerprint": [], "content_type": "", "style": "", "subject": "", "composition": "", "mood": "" },
  "shutterstock": { "title": "", "description": "", "keywords": [], "category": "" },
  "adobe": { "title": "", "description": "", "keywords": [], "category": "" },
  "trend_analysis": { "opportunity": "High", "match_percent": 0, "matched_trends": [], "supported_trend_keywords": [], "reason": "" },
  "quality_signals": { "visual_relevance": 0, "title_quality": 0, "description_quality": 0, "keyword_relevance": 0, "keyword_diversity": 0, "trend_opportunity": 0 }
}
`;
}

async function generateWithGemini(apiKey, inputMime, inputBuffer, prompt) {
  const ai = new GoogleGenAI({ apiKey });
  const contents = [{ inlineData: { mimeType: inputMime, data: inputBuffer.toString("base64") } }, { text: prompt }];
  const response = await ai.models.generateContent({ model: "gemini-3.7-flash", contents });
  if (!response || !response.text) throw new Error("Gemini tidak memberikan response.");
  return parseJsonResponse(response.text);
}

app.get("/api/status", (req, res) => res.json({ status: "online", message: "Vector Metadata Pro server is working!" }));

app.post("/api/generate", upload.single("image"), async (req, res) => {
  let vectorPreview = null;
  try {
    const geminiKey = String(req.body.apiKey || req.body.geminiApiKey || "").trim();

    if (!geminiKey) {
      return res.status(400).json({ error: "Gemini API Key belum dimasukkan.", code: "MISSING_API_KEY" });
    }
    if (!req.file) return res.status(400).json({ error: "Silakan upload file terlebih dahulu.", code: "MISSING_FILE" });

    const ext = getExt(req.file.originalname);
    if (!ALL_EXTS.includes(ext)) {
      return res.status(400).json({ error: `Format ${ext.toUpperCase()} tidak didukung.`, code: "UNSUPPORTED_FILE_TYPE" });
    }

    let mediaType = String(req.body.mediaType || "image").toLowerCase();
    if (!["image", "video", "vector"].includes(mediaType)) mediaType = "image";
    if (VECTOR_EXTS.includes(ext)) mediaType = "vector";
    if (VIDEO_EXTS.includes(ext)) mediaType = "video";
    if (IMAGE_EXTS.includes(ext) && mediaType === "vector") mediaType = "image";

    let avoidTitles = [];
    let avoidDescriptions = [];
    try { avoidTitles = JSON.parse(req.body.avoidTitles || "[]"); } catch {}
    try { avoidDescriptions = JSON.parse(req.body.avoidDescriptions || "[]"); } catch {}
    avoidTitles = cleanArray(avoidTitles, 30);
    avoidDescriptions = cleanArray(avoidDescriptions, 30);

    let inputBuffer = req.file.buffer;
    let inputMime = req.file.mimetype;
    if (IMAGE_EXTS.includes(ext)) inputMime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext];
    if (VECTOR_EXTS.includes(ext)) {
      vectorPreview = await rasterizeVector(req.file.buffer, req.file.originalname);
      inputBuffer = vectorPreview.buffer;
      inputMime = vectorPreview.mimeType;
    }
    if (VIDEO_EXTS.includes(ext)) inputMime = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4" }[ext];

    const prompt = constructPrompt(mediaType, ext, avoidTitles, avoidDescriptions);

    console.log(`Executing Gemini API: gemini-3.7-flash | ${req.file.originalname}`);
    const rawMetadata = await generateWithGemini(geminiKey, inputMime, inputBuffer, prompt);
    const usedEngine = "Gemini AI (3.7-Flash)";

    const metadata = normalizeMetadata(rawMetadata);
    metadata.quality_signals = {
      adobe: calculateQualitySignals(metadata, "adobe"),
      shutterstock: calculateQualitySignals(metadata, "shutterstock")
    };
    metadata.quality_score_2_0 = Math.round((metadata.quality_signals.adobe.total + metadata.quality_signals.shutterstock.total) / 2);
    metadata.media = { type: mediaType, extension: ext };
    metadata.engine_used = usedEngine;
    res.json(metadata);

  } catch (error) {
    console.error("SERVER ERROR:", error);
    res.status(500).json({
      error: "Gagal Memproses Metadata dengan Gemini AI",
      details: { gemini: formatApiError(error) },
      code: "GEMINI_FAILED"
    });
  } finally {
    if (vectorPreview?.cleanup) await vectorPreview.cleanup().catch(() => {});
  }
});

app.listen(PORT, () => console.log(`\nVECTOR METADATA PRO V3\nServer aktif di port: ${PORT}\n`));
