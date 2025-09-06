import fs from "fs/promises";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { getQueryEmbedding } from "./embeddingClient.js";
import { search } from "./search.js";

dotenv.config();

const PORT = process.env.PORT || 3000;
const KB_PATH = process.env.KB_PATH || "./output.json";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

// Serve extracted images
app.use("/images", express.static(path.resolve("./uploads/images")));

// -------------------- Load KB --------------------
let kb = [];
async function loadKB() {
  try {
    const raw = await fs.readFile(KB_PATH, "utf-8");
    const pages = JSON.parse(raw);

    kb = pages
      .map((p, i) => ({
        page_number: p.page_number ?? i + 1,
        text: (p.text || "").trim(),
        embedding: p.text_embedding ?? null,
        images: p.images ?? [],
      }))
      .filter(item => item.text && item.embedding);

    console.log(`✅ Knowledge base loaded: ${kb.length} entries`);
  } catch (err) {
    console.error("❌ Failed to load KB:", err);
  }
}
await loadKB();

// -------------------- Cosine similarity --------------------
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1e-10);
}

// -------------------- Retrieve Top K --------------------
async function retrieveTopK(query, k = 3) {
  const qEmb = await getQueryEmbedding(query);
  const results = await search(qEmb, 0.05, k);

  return results.map(r => {
    const kbPage = kb.find(p => p.page_number === r.page_number);
    
    let relevantImages = [];
    if (kbPage?.images && kbPage.images.length > 0) {
      relevantImages = kbPage.images.filter(img => {
        if (!img.embedding || img.embedding.length === 0) return false;
        const imgEmb = img.embedding;
        const sim = cosineSimilarity(qEmb, imgEmb);
        if (sim > 0.1) console.log(`📸 Image "${img.filename}" similarity: ${sim.toFixed(4)}`);
        return sim > 0.15;
      });
    }

    return {
      ...r,
      images: relevantImages
    };
  });
}

// -------------------- Helper: Summarize KB --------------------
async function summarizeContext(topResults) {
  const texts = topResults.map(c => c.text).join("\n---\n");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b:free",
      messages: [
        { role: "system", content: "You are a helpful assistant. Summarize the following content concisely for answering a question." },
        { role: "user", content: texts }
      ],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || texts;
}

// -------------------- Chat endpoint (POST) --------------------
app.post("/chat", async (req, res) => {
  try {
    const userQuery = req.body.message?.trim();
    if (!userQuery) return res.status(400).json({ error: "message required" });

    const wantsImage = /image|diagram|picture|visual|figure|screenshot|photo|illustration|chart|graph|drawing/i.test(userQuery);
    const smallTalkRegex = /\b(hi|hello|hey|how are you|good morning|good afternoon|good evening)\b/i;
    const isSmallTalk = smallTalkRegex.test(userQuery);

    let answer = "Sorry, I can't help with that.";
    let topResults = [];

    if (isSmallTalk) {
      const greetings = ["Hey! 👋","Hello! 😊","Hi there!","Hey, how's it going?","Hi! Hope you're doing well!"];
      answer = greetings[Math.floor(Math.random() * greetings.length)];
    } else {
      topResults = await retrieveTopK(userQuery, 3);
      const KB_THRESHOLD = 0.05;

      if (wantsImage) {
        const wordCount = userQuery.split(/\s+/).length;
        const isGenericRequest = /(show|see|give).*(image|picture|diagram)/i.test(userQuery) && wordCount <= 4;
        if (isGenericRequest) {
          answer = "I'd be happy to show you images! Could you be more specific?";
          res.json({ reply: answer, query: userQuery, images: [], top_results: [] });
          return;
        }

        if (topResults[0]?.score >= KB_THRESHOLD) {
          const allImages = topResults.flatMap(r =>
            r.images.map(img => ({ filename: img.filename, url: img.url.replace(/^\/uploads\/images/, "/images"), width: img.width, height: img.height }))
          );
          if (allImages.length > 0) {
            answer = `I found ${allImages.length} relevant image(s) for "${userQuery}"`;
            res.json({ reply: answer, query: userQuery, images: allImages });
            return;
          }
        }

        answer = "Couldn't find any relevant images in the knowledge base.";
        res.json({ reply: answer, query: userQuery, images: [] });
        return;
      }

      if (topResults[0]?.score >= KB_THRESHOLD) {
        const summaryText = await summarizeContext(topResults);
        const chatRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b:free",
            messages: [
              { role: "system", content: "You are a helpful assistant. Give concise answers." },
              { role: "user", content: `Summary:\n${summaryText}\n\nQuestion:\n${userQuery}` },
            ],
          }),
        });
        const chatData = await chatRes.json();
        answer = chatData.choices?.[0]?.message?.content || answer;
      }
    }

    res.json({
      reply: answer,
      query: userQuery,
      top_results: topResults.map(t => ({
        id: t.page_number,
        score: t.score,
        text: t.text,
      })),
      images: [],
    });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ error: "Failed to process query", details: err.message });
  }
});

// -------------------- Chat endpoint (GET SSE streaming) --------------------
app.get("/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const userQuery = req.query.q?.trim();
  if (!userQuery) {
    res.write(`data: ${JSON.stringify({ error: "message required" })}\n\n`);
    res.end();
    return;
  }

  try {
    const wantsImage = /image|diagram|picture|visual|figure|screenshot|photo|illustration|chart|graph|drawing/i.test(userQuery);
    const topResults = await retrieveTopK(userQuery, 3);
    const KB_THRESHOLD = 0.05;

    let contextText = "";
    if (topResults[0]?.score >= KB_THRESHOLD) {
      contextText = await summarizeContext(topResults);
    }

    if (wantsImage) {
      const wordCount = userQuery.split(/\s+/).length;
      const isGenericRequest = /(show|see|give).*(image|picture|diagram)/i.test(userQuery) && wordCount <= 4;
      if (isGenericRequest) {
        res.write(`data: ${JSON.stringify({ token: "I'd be happy to show you images! Could you be more specific?" })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      if (topResults[0]?.score >= KB_THRESHOLD) {
        const images = topResults.flatMap(r =>
          r.images.map(img => ({ filename: img.filename, url: img.url.replace(/^\/uploads\/images/, "/images"), width: img.width, height: img.height }))
        );
        if (images.length > 0) {
          res.write(`data: ${JSON.stringify({ token: `I found ${images.length} relevant image(s) for "${userQuery}"` })}\n\n`);
          res.write(`data: ${JSON.stringify({ images })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
      }

      res.write(`data: ${JSON.stringify({ token: "Couldn't find any relevant images." })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Normal text streaming
    const chatRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b:free",
        stream: true,
        messages: [
          { role: "system", content: "You are a helpful assistant. Give concise answers." },
          { role: "user", content: `Summary:\n${contextText}\n\nQuestion:\n${userQuery}` },
        ],
      }),
    });

    if (!chatRes.ok || !chatRes.body) throw new Error("Failed to connect to OpenRouter");

    const decoder = new TextDecoder("utf-8");
    for await (const chunk of chatRes.body) {
      const str = decoder.decode(chunk, { stream: true });
      const lines = str.split("\n").filter(l => l.trim().startsWith("data:"));

      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") continue;
        try {
          const data = JSON.parse(payload);
          const token = data.choices?.[0]?.delta?.content;
          if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
        } catch {
          console.warn("Non-JSON SSE chunk:", payload);
        }
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("❌ Streaming error:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
