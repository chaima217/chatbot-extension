// embeddingClient.js
import fetch from 'node-fetch';

const EMBEDDING_SERVER = "http://127.0.0.1:5001";
const TIMEOUT = 30000; // 30 seconds

async function fetchWithTimeout(url, options = {}, timeout = TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
    }
}

export async function getQueryEmbedding(query) {
    try {
        const response = await fetchWithTimeout(`${EMBEDDING_SERVER}/embed/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: query }),
        }, 20000); // 20s timeout
        
        const raw = await response.text();
        try {
            const data = JSON.parse(raw);
            if (!data.embedding) throw new Error("No embedding returned");
            return data.embedding;
        } catch {
            console.error("❌ Embedding server returned invalid response:", raw);
            return [];
        }
    } catch (error) {
        console.error("❌ Embedding API error:", error.message);
        throw error;
    }
}


export async function getBatchEmbeddings(texts) {
    try {
        const response = await fetchWithTimeout(`${EMBEDDING_SERVER}/embed/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts }),
        }, 30000); // 30s timeout for batch
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return data.embeddings || [];
    } catch (error) {
        console.error("❌ Batch embedding error:", error.message);
        throw error;
    }
}

export async function calculateSimilarity(text1, text2) {
    try {
        const response = await fetchWithTimeout(`${EMBEDDING_SERVER}/similarity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text1, text2 }),
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error("❌ Similarity API error:", error);
        throw error;
    }
}

export async function checkHealth() {
    try {
        const response = await fetchWithTimeout(`${EMBEDDING_SERVER}/health`, {}, 5000);
        return response.ok;
    } catch {
        return false;
    }
}

// Fallback to local embeddings if server is down
let localEmbedder = null;
async function getLocalEmbeddingFallback(query) {
    try {
        if (!localEmbedder) {
            // Lazy load local embedder only if needed
            const { pipeline } = await import('@xenova/transformers');
            localEmbedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        }
        
        const output = await localEmbedder(query, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (error) {
        console.error("❌ Local fallback also failed:", error);
        return [];
    }
}


export async function getQueryEmbeddingWithFallback(query) {
    try {
        return await getQueryEmbedding(query);
    } catch (error) {
        console.warn("⚠️ Falling back to local embedding generation");
        return await getLocalEmbeddingFallback(query);
    }
}

