// embeddingClient.js - OPTIMIZED VERSION
import fetch from 'node-fetch';
import NodeCache from 'node-cache';

const EMBEDDING_SERVER = "http://127.0.0.1:5001";
const TIMEOUT = 60000;

// In-memory cache for embeddings (cache for 1 hour)
const embeddingCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Request queue to batch multiple requests
let requestQueue = [];
let batchTimeout = null;
const BATCH_DELAY = 50; // Wait 50ms to collect requests

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

// Generate cache key from text
function getCacheKey(text) {
    return `emb_${text.trim().toLowerCase().slice(0, 100)}`;
}

// Process batched requests
async function processBatch() {
    if (requestQueue.length === 0) return;
    
    const batch = [...requestQueue];
    requestQueue = [];
    
    try {
        // Separate cached and uncached
        const uncached = [];
        const results = new Map();
        
        for (const item of batch) {
            const cached = embeddingCache.get(getCacheKey(item.text));
            if (cached) {
                results.set(item.text, cached);
                item.resolve(cached);
            } else {
                uncached.push(item);
            }
        }
        
        // Batch fetch uncached embeddings
        if (uncached.length > 0) {
            const texts = uncached.map(item => item.text);
            const response = await fetchWithTimeout(`${EMBEDDING_SERVER}/embed/batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ texts }),
            }, 15000);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const embeddings = data.embeddings || [];
            
            // Cache and resolve
            uncached.forEach((item, index) => {
                const embedding = embeddings[index];
                if (embedding) {
                    embeddingCache.set(getCacheKey(item.text), embedding);
                    item.resolve(embedding);
                } else {
                    item.reject(new Error('No embedding returned'));
                }
            });
        }
    } catch (error) {
        // Reject all pending requests
        batch.forEach(item => {
            if (!results.has(item.text)) {
                item.reject(error);
            }
        });
    }
}

// Queue a request for batching
function queueRequest(text) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ text, resolve, reject });
        
        // Clear existing timeout and set new one
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(() => {
            processBatch();
            batchTimeout = null;
        }, BATCH_DELAY);
    });
}

export async function getQueryEmbedding(query) {
    if (!query || !query.trim()) {
        return [];
    }
    
    const cacheKey = getCacheKey(query);
    
    // Check cache first
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
        console.log('✅ Cache hit for query');
        return cached;
    }
    
    try {
        // Use batching for better performance
        const embedding = await queueRequest(query);
        return embedding;
    } catch (error) {
        console.error("❌ Embedding API error:", error.message);
        throw error;
    }
}

export async function getBatchEmbeddings(texts) {
    const uncachedTexts = [];
    const results = [];
    
    // Check cache for each text
    for (const text of texts) {
        const cacheKey = getCacheKey(text);
        const cached = embeddingCache.get(cacheKey);
        
        if (cached) {
            results.push(cached);
        } else {
            uncachedTexts.push(text);
            results.push(null); // Placeholder
        }
    }
    
    // Fetch uncached embeddings
    if (uncachedTexts.length > 0) {
        try {
            const response = await fetchWithTimeout(`${EMBEDDING_SERVER}/embed/batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ texts: uncachedTexts }),
            }, 15000);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            const embeddings = data.embeddings || [];
            
            // Fill in results and cache
            let embIndex = 0;
            for (let i = 0; i < results.length; i++) {
                if (results[i] === null) {
                    const embedding = embeddings[embIndex++];
                    results[i] = embedding;
                    embeddingCache.set(getCacheKey(texts[i]), embedding);
                }
            }
        } catch (error) {
            console.error("❌ Batch embedding error:", error.message);
            throw error;
        }
    }
    
    return results;
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

// Clear cache function (useful for debugging)
export function clearCache() {
    embeddingCache.flushAll();
    console.log('🗑️ Embedding cache cleared');
}

// Get cache stats
export function getCacheStats() {
    return {
        keys: embeddingCache.keys().length,
        hits: embeddingCache.getStats().hits,
        misses: embeddingCache.getStats().misses
    };
}