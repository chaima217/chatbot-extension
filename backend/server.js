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
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";

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

// -------------------- Response validation --------------------
function isGoodResponse(text) {
  // Check for word repetition (like "Entschuldigung, Entschuldigung")
  const words = text.split(' ');
  const uniqueWords = new Set(words);
  return (uniqueWords.size / words.length) > 0.6;
}

// -------------------- Retrieve Top K --------------------
async function retrieveTopK(query, k = 3) {
  const qEmb = await getQueryEmbedding(query);
  const results = await search(qEmb, 0.05, k);

  return results.map(r => {
    const kbPage = kb.find(p => p.page_number === r.page_number);
    
    let relevantImages = [];
    if (kbPage?.images && kbPage.images.length > 0) {
      const wantsImage = /image|diagram|picture|visual|figure|screenshot|photo|illustration|chart|graph|drawing/i.test(query);
      
      if (wantsImage) {
        relevantImages = kbPage.images.filter(img => {
          if (!img.embedding || img.embedding.length === 0) return false;
          const sim = cosineSimilarity(qEmb, img.embedding);
          console.log(`🔍 Image "${img.filename}" similarity: ${sim.toFixed(4)}`);
          return sim > 0.1;
        });
        
        if (relevantImages.length === 0 && r.score > 0.3) {
          console.log(`📄 Including all images from page ${r.page_number} (high text match)`);
          relevantImages = kbPage.images;
        }
      }
    }

    return {
      ...r,
      images: relevantImages
    };
  });
}

async function queryHuggingFace(messages) {
  const userMessage = messages[messages.length - 1].content;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s
  try{
  const response = await fetch("https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: userMessage,
      parameters: { max_new_tokens: 100 }
    })
  });

  if (!response.ok) throw new Error(`Hugging Face error: ${response.status}`);
  return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/*
// -------------------- OpenRouter API Helper --------------------
async function queryOpenRouter(messages) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000", // Add this
      "X-Title": "Chatbot" // Add this
    },
    body: JSON.stringify({
      model: "google/gemma-2-2b-it:free",
      messages: messages,
      max_tokens: 300,
      temperature: 0.7,
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${error}`);
  }

  return response;
}
*/
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
      res.json({ reply: answer, query: userQuery, images: [], top_results: [] });
      return;
    }

    const startTime = Date.now();
    topResults = await retrieveTopK(userQuery, 2);
    console.log(`⏱️ Retrieval took: ${Date.now() - startTime}ms`);

    const KB_THRESHOLD = 0.05;

    // Handle image requests
    if (wantsImage) {
      const wordCount = userQuery.split(/\s+/).length;
      const isGenericRequest = /(show|see|give).*(image|picture|diagram)/i.test(userQuery) && wordCount <= 4;
      
      if (isGenericRequest) {
        answer = "I'd be happy to show you images! Could you be more specific?";
        res.json({ reply: answer, query: userQuery, images: [], top_results: [] });
        return;
      }

      if (topResults.length > 0 && topResults[0]?.score >= KB_THRESHOLD) {
        const allImages = topResults.flatMap(r => {
          if (!r.images || r.images.length === 0) return [];
          
          return r.images.map(img => {
            let imageUrl = img.url || `/images/${img.filename}`;
            if (imageUrl.startsWith('/uploads/images')) {
              imageUrl = imageUrl.replace('/uploads/images', '/images');
            }
            if (!imageUrl.startsWith('/images/') && !imageUrl.startsWith('http')) {
              imageUrl = `/images/${img.filename}`;
            }
            
            return { 
              filename: img.filename,
              url: imageUrl,
              width: img.width || 800,
              height: img.height || 600,
              relevance: r.score
            };
          });
        });
        
        console.log(`🖼️ Found ${allImages.length} images:`, allImages.map(i => i.url));
        
        if (allImages.length > 0) {
          answer = `Here ${allImages.length === 1 ? 'is' : 'are'} ${allImages.length} relevant image${allImages.length > 1 ? 's' : ''}:`;
          res.json({ 
            reply: answer, 
            query: userQuery, 
            images: allImages,
            hasImages: true 
          });
          return;
        }
      }

      answer = "I couldn't find any relevant images for that query in my knowledge base.";
      res.json({ reply: answer, query: userQuery, images: [], hasImages: false });
      return;
    }

    // Handle text queries with OpenRouter
    /*
    if (topResults[0]?.score >= KB_THRESHOLD) {
      const contextText = topResults
        .slice(0, 2)
        .map(r => r.text.slice(0, 1500))
        .join("\n---\n");

      const apiStart = Date.now();
      
      try {
        const hfResponse = await queryHuggingFace([
          { 
            role: "system", 
            content: "You are a helpful assistant. Answer concisely based on the provided context. If the context doesn't contain the answer, say so briefly." 
          },
          { 
            role: "user", 
            content: `Context:\n${contextText}\n\nQuestion: ${userQuery}\n\nAnswer concisely:` 
          }
        ]);
        
        const data = await hfResponse.json();
        answer = data[0]?.generated_text || "I couldn't generate a response.";
        
        answer = data.choices?.[0]?.message?.content || "I couldn't generate a response.";
        if (!isGoodResponse(answer)) {
          console.log("⚠️ Detected low-quality response, replacing with fallback message.");
          answer = "I couldn't find relevant information in my knowledge base to answer that question.";
        }
        
      } catch (error) {
        console.error("OpenRouter error:", error);
        answer = "Sorry, the AI service is currently unavailable. Please try again.";
      }
    } else {
      answer = "I couldn't find relevant information in my knowledge base to answer that question.";
    }
*/
      // Handle text queries - SIMPLE MODE WITHOUT API
    if (topResults[0]?.score >= KB_THRESHOLD) {
      const bestMatch = topResults[0];
      answer = `I found relevant information from page ${bestMatch.page_number}:\n\n"${bestMatch.text.slice(0, 400)}..."`;
    } else {
      answer = "I couldn't find relevant information in my knowledge base to answer that question.";
    }
    console.log(`⏱️ Total time: ${Date.now() - startTime}ms`);

    res.json({
      reply: answer,
      query: userQuery,
      top_results: topResults.map(t => ({
        id: t.page_number,
        score: t.score.toFixed(3),
        text: t.text.slice(0, 200) + "..."
      })),
      images: [],
    });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ error: "Failed to process query", details: err.message });
  }
});

// -------------------- Chat endpoint (GET SSE streaming) --------------------
// -------------------- Chat endpoint (GET SSE streaming) --------------------
app.get("/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const userQuery = req.query.q?.trim();
  if (!userQuery) {
    res.write(`data: ${JSON.stringify({ error: "message required" })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  // --- Small talk handling ---
  const smallTalkRegex = /\b(hi|hello|hey|how are you|good morning|good afternoon|good evening)\b/i;
  if (smallTalkRegex.test(userQuery)) {
    const greetings = ["Hey! 👋","Hello! 😊","Hi there!","Hey, how's it going?","Hi! Hope you're doing well!"];
    const answer = greetings[Math.floor(Math.random() * greetings.length)];

    res.write(`data: ${JSON.stringify({ token: answer })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  try {
    const wantsImage = /image|diagram|picture|visual|figure|screenshot|photo|illustration|chart|graph|drawing/i.test(userQuery);
    const topResults = await retrieveTopK(userQuery, 2);
    const KB_THRESHOLD = 0.05;

    // --- Image queries ---
    if (wantsImage) {
      const wordCount = userQuery.split(/\s+/).length;
      const isGenericRequest = /(show|see|give).*(image|picture|diagram)/i.test(userQuery) && wordCount <= 4;

      if (isGenericRequest) {
        res.write(`data: ${JSON.stringify({ token: "I'd be happy to show you images! Could you be more specific?" })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      if (topResults.length > 0 && topResults[0]?.score >= KB_THRESHOLD) {
        const images = topResults.flatMap(r => {
          if (!r.images || r.images.length === 0) return [];

          return r.images.map(img => {
            let imageUrl = img.url || `/images/${img.filename}`;
            if (imageUrl.startsWith('/uploads/images')) imageUrl = imageUrl.replace('/uploads/images', '/images');
            if (!imageUrl.startsWith('/images/') && !imageUrl.startsWith('http')) imageUrl = `/images/${img.filename}`;

            return { 
              filename: img.filename,
              url: imageUrl,
              width: img.width || 800,
              height: img.height || 600,
              relevance: r.score
            };
          });
        });

        if (images.length > 0) {
          res.write(`data: ${JSON.stringify({ token: `Here ${images.length === 1 ? 'is' : 'are'} ${images.length} relevant image${images.length > 1 ? 's' : ''}:` })}\n\n`);
          res.write(`data: ${JSON.stringify({ images, hasImages: true })}\n\n`);
          res.write("data: [DONE]\n\n");
          return res.end();
        }
      }

      res.write(`data: ${JSON.stringify({ token: "I couldn't find any relevant images for that query." })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    // --- Text queries ---
    let answer = "";
    if (topResults.length > 0 && topResults[0]?.score >= KB_THRESHOLD) {
      const bestMatch = topResults[0];
      answer = `I found relevant information from page ${bestMatch.page_number}: "${bestMatch.text.slice(0, 300)}..."`;
    } else {
      answer = "I couldn't find relevant information in my knowledge base for that question.";
    }

    // Stream answer word by word for better frontend UX
    const words = answer.split(' ');
    for (const word of words) {
      res.write(`data: ${JSON.stringify({ token: word + ' ' })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 30)); // 30ms between words
    }

    res.write("data: [DONE]\n\n");
    res.end();

  } catch (err) {
    console.error("❌ Streaming error:", err);
    res.write(`data: ${JSON.stringify({ token: "Sorry, an error occurred." })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});
// Sauvegarder l'historique
app.post("/chat/history", async (req, res) => {
  try {
    const { user_id, query, response } = req.body;
    
    // Appelle ton API Python pour sauvegarder
    const saveResponse = await fetch("http://localhost:5001/save_history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id, query, response })
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error("History save error:", err);
    res.status(500).json({ error: "Failed to save history" });
  }
});

// Récupérer l'historique
app.get("/chat/history/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const historyResponse = await fetch(`http://localhost:5001/get_history/${user_id}`);
    const history = await historyResponse.json();
    
    res.json(history);
  } catch (err) {
    console.error("History fetch error:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});
// -------------------- Health Check --------------------
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    kb_entries: kb.length,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));