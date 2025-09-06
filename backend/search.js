// search.js
import fs from "fs";

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (magA * magB);
}

function flattenEmbedding(embedding) {
  if (!embedding) return [];
  if (Array.isArray(embedding[0])) return embedding.flat(Infinity);
  return embedding;
}

export function search(queryEmbedding, threshold = 0.2, k = 3) {
  const data = JSON.parse(fs.readFileSync("./output.json", "utf-8"));
  const queryEmb = flattenEmbedding(queryEmbedding);

  const scored = data.map((page) => {
    const pageEmb = flattenEmbedding(page.text_embedding);
    let score = 0;

    if (pageEmb.length === queryEmb.length && pageEmb.length > 0) {
      score = cosineSimilarity(pageEmb, queryEmb);
    }

    return { ...page, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Log top results for debugging
  console.log("🔍 Top matches:", scored.slice(0, 3).map(r => ({
    page: r.page_number,
    score: r.score
  })));

  return scored.filter(r => r.score >= threshold).slice(0, k);
}
