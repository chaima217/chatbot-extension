// server.js
import fs from "fs/promises";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { getQueryEmbedding } from "./embeddingClient.js"; // local embeddings
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
  let dot = 0,
    na = 0,
    nb = 0;
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

    let relevantImages = (kbPage?.images ?? []).filter(img => {
      if (!img.embedding) return false;
      const imgEmb = Array.isArray(img.embedding[0])
        ? img.embedding.flat(Infinity)
        : img.embedding;
      if (imgEmb.length !== qEmb.length) return false;
      const sim = cosineSimilarity(qEmb, imgEmb);
      return sim > 0.2;
    });

    return {
      ...r,
      images: relevantImages
    };
  });
}

// -------------------- Chat endpoint (POST) --------------------
app.post("/chat", async (req, res) => {
  try {
    const userQuery = req.body.message?.trim();
    if (!userQuery) return res.status(400).json({ error: "message required" });

    const wantsImage = /image|diagram|picture|visual|figure/i.test(userQuery);

    // Small talk detection
    const smallTalkRegex = /\b(hi|hello|hey|how are you|good morning|good afternoon|good evening)\b/i;
    const isSmallTalk = smallTalkRegex.test(userQuery);

    let answer = "Sorry, I can't help with that.";
    let topResults = [];

    if (isSmallTalk) {
      const chatRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b:free",
          messages: [
            { role: "system", content: "You are a friendly assistant." },
            { role: "user", content: userQuery },
          ],
        }),
      });
      const chatData = await chatRes.json();
      answer = chatData.choices?.[0]?.message?.content || "Hello!";
    } else {
      topResults = await retrieveTopK(userQuery, 3);
      const KB_THRESHOLD = 0.05;

      if (!wantsImage && topResults[0]?.score >= KB_THRESHOLD) {
        const contextText = topResults.map(c => c.text).join("\n---\n");
        const chatRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b:free",
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: `Context:\n${contextText}\n\nQuestion:\n${userQuery}` },
            ],
          }),
        });
        const chatData = await chatRes.json();
        answer = chatData.choices?.[0]?.message?.content || answer;
      }
    }

    const images = wantsImage
      ? topResults.flatMap(r =>
          r.images.map(img => ({
            filename: img.filename,
            url: img.url,
            width: img.width,
            height: img.height,
          }))
        )
      : [];

    res.json({
      reply: answer,
      query: userQuery,
      top_results: topResults.map(t => ({
        id: t.page_number,
        score: t.score,
        text: t.text,
      })),
      images,
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
    const wantsImage = /image|diagram|picture|visual|figure/i.test(userQuery);
    const topResults = await retrieveTopK(userQuery, 3);
    const KB_THRESHOLD = 0.05;

    let contextText = "";
    if (topResults[0]?.score >= KB_THRESHOLD) {
      contextText = topResults.map(c => c.text).join("\n---\n");
    }

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
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: `Context:\n${contextText}\n\nQuestion:\n${userQuery}` },
        ],
      }),
    });

    if (!chatRes.ok || !chatRes.body) throw new Error("Failed to connect to OpenRouter");

    const decoder = new TextDecoder("utf-8");
    let botReply = "";

    // Node.js ReadableStream async iteration
    for await (const chunk of chatRes.body) {
      const str = decoder.decode(chunk, { stream: true });
      const lines = str.split("\n").filter(l => l.trim().startsWith("data:"));

      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, "");
        if (payload === "[DONE]") continue;

        try {
          const data = JSON.parse(payload);
          const token = data.choices?.[0]?.delta?.content;
          if (token) {
            botReply += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch {
          console.warn("Non-JSON SSE chunk:", payload);
        }
      }
    }

    if (wantsImage) {
      const images = topResults.flatMap(r =>
        r.images.map(img => ({
          filename: img.filename,
          url: img.url,
          width: img.width,
          height: img.height,
        }))
      );
      if (images.length > 0) {
        res.write(`data: ${JSON.stringify({ images })}\n\n`);
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
