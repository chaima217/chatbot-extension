# embedding_server.py - OPTIMIZED VERSION
from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer, util
import logging
import threading
from functools import lru_cache
import hashlib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global model variable - loaded ONCE at startup
text_model = None
model_lock = threading.Lock()

# In-memory cache for embeddings
embedding_cache = {}
cache_lock = threading.Lock()
MAX_CACHE_SIZE = 10000

def get_cache_key(text):
    """Generate cache key from text hash"""
    return hashlib.md5(text.encode('utf-8')).hexdigest()

def load_models():
    """Load models at startup"""
    global text_model
    with model_lock:
        if text_model is None:
            try:
                logger.info("⏳ Loading text embedding model...")
                text_model = SentenceTransformer("all-MiniLM-L6-v2")
                # Warm up the model with a dummy encoding
                text_model.encode("warmup", show_progress_bar=False)
                logger.info("✅ Text model loaded and warmed up")
            except Exception as e:
                logger.error(f"❌ Failed to load text model: {e}")
                raise

# Load models immediately at startup
logger.info("🚀 Starting Embedding Server...")
load_models()

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy", 
        "text_model_loaded": text_model is not None,
        "cache_size": len(embedding_cache)
    })

@app.route("/embed/text", methods=["POST"])
def embed_text():
    """Generate embedding for text - OPTIMIZED with caching"""
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "Missing 'text' in request body"}), 400
        
        text = data["text"].strip()
        if not text:
            return jsonify({"embedding": []})
        
        # Check cache first
        cache_key = get_cache_key(text)
        with cache_lock:
            if cache_key in embedding_cache:
                logger.debug(f"✅ Cache hit for text")
                return jsonify({
                    "embedding": embedding_cache[cache_key],
                    "dimensions": len(embedding_cache[cache_key]),
                    "model": "all-MiniLM-L6-v2",
                    "cached": True
                })
        
        # Generate embedding
        embedding = text_model.encode(
            text, 
            convert_to_tensor=True, 
            show_progress_bar=False,
            normalize_embeddings=True
        )
        
        embedding_list = embedding.cpu().tolist()
        
        # Cache the result
        with cache_lock:
            if len(embedding_cache) >= MAX_CACHE_SIZE:
                # Simple FIFO cache eviction
                embedding_cache.pop(next(iter(embedding_cache)))
            embedding_cache[cache_key] = embedding_list
        
        return jsonify({
            "embedding": embedding_list,
            "dimensions": len(embedding_list),
            "model": "all-MiniLM-L6-v2",
            "cached": False
        })
        
    except Exception as e:
        logger.error(f"Error in embed_text: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/embed/batch", methods=["POST"])
def embed_batch():
    """Generate embeddings for multiple texts - OPTIMIZED"""
    try:
        data = request.get_json()
        if not data or "texts" not in data:
            return jsonify({"error": "Missing 'texts' array"}), 400
        
        texts = [t.strip() for t in data["texts"] if t.strip()]
        if not texts:
            return jsonify({"embeddings": []})
        
        # Check cache for each text
        results = []
        uncached_texts = []
        uncached_indices = []
        
        with cache_lock:
            for i, text in enumerate(texts):
                cache_key = get_cache_key(text)
                if cache_key in embedding_cache:
                    results.append(embedding_cache[cache_key])
                else:
                    results.append(None)
                    uncached_texts.append(text)
                    uncached_indices.append(i)
        
        # Batch process uncached texts
        if uncached_texts:
            logger.info(f"📊 Processing {len(uncached_texts)} uncached texts")
            embeddings = text_model.encode(
                uncached_texts, 
                convert_to_tensor=True,
                show_progress_bar=False,
                batch_size=64,  # Increased batch size
                normalize_embeddings=True
            )
            
            embeddings_list = embeddings.cpu().tolist()
            
            # Cache and fill results
            with cache_lock:
                for i, emb in enumerate(embeddings_list):
                    idx = uncached_indices[i]
                    results[idx] = emb
                    
                    # Cache it
                    if len(embedding_cache) < MAX_CACHE_SIZE:
                        cache_key = get_cache_key(uncached_texts[i])
                        embedding_cache[cache_key] = emb
        
        return jsonify({
            "embeddings": results,
            "count": len(texts),
            "dimensions": len(results[0]) if results else 0,
            "cached_count": len(texts) - len(uncached_texts)
        })
        
    except Exception as e:
        logger.error(f"Error in embed_batch: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/similarity", methods=["POST"])
def calculate_similarity():
    """Calculate similarity between two texts - OPTIMIZED"""
    try:
        data = request.get_json()
        if not data or "text1" not in data or "text2" not in data:
            return jsonify({"error": "Missing texts"}), 400
        
        text1 = data["text1"].strip()
        text2 = data["text2"].strip()
        
        if not text1 or not text2:
            return jsonify({"error": "Texts cannot be empty"}), 400
        
        # Check cache for both texts
        cache_key1 = get_cache_key(text1)
        cache_key2 = get_cache_key(text2)
        
        emb1 = None
        emb2 = None
        
        with cache_lock:
            if cache_key1 in embedding_cache:
                emb1 = embedding_cache[cache_key1]
            if cache_key2 in embedding_cache:
                emb2 = embedding_cache[cache_key2]
        
        # Generate missing embeddings
        texts_to_encode = []
        if emb1 is None:
            texts_to_encode.append(text1)
        if emb2 is None:
            texts_to_encode.append(text2)
        
        if texts_to_encode:
            embeddings = text_model.encode(
                texts_to_encode,
                convert_to_tensor=True,
                show_progress_bar=False,
                normalize_embeddings=True
            )
            
            if emb1 is None:
                emb1 = embeddings[0] if len(texts_to_encode) == 2 else embeddings
                emb1_list = emb1.cpu().tolist()
                with cache_lock:
                    if len(embedding_cache) < MAX_CACHE_SIZE:
                        embedding_cache[cache_key1] = emb1_list
            
            if emb2 is None:
                emb2 = embeddings[1] if len(texts_to_encode) == 2 else embeddings
                emb2_list = emb2.cpu().tolist()
                with cache_lock:
                    if len(embedding_cache) < MAX_CACHE_SIZE:
                        embedding_cache[cache_key2] = emb2_list
        
        # Calculate similarity
        import torch
        if isinstance(emb1, list):
            emb1 = torch.tensor(emb1)
        if isinstance(emb2, list):
            emb2 = torch.tensor(emb2)
            
        similarity = util.pytorch_cos_sim(emb1, emb2).item()
        
        return jsonify({
            "similarity": float(similarity)
        })
        
    except Exception as e:
        logger.error(f"Error in similarity: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/cache/clear", methods=["POST"])
def clear_cache():
    """Clear the embedding cache"""
    with cache_lock:
        embedding_cache.clear()
    return jsonify({"message": "Cache cleared", "status": "success"})

@app.route("/cache/stats", methods=["GET"])
def cache_stats():
    """Get cache statistics"""
    with cache_lock:
        return jsonify({
            "size": len(embedding_cache),
            "max_size": MAX_CACHE_SIZE,
            "hit_rate": "N/A"  # Would need request counter to calculate
        })

if __name__ == "__main__":
    print("🚀 Optimized Embedding Server on http://127.0.0.1:5001")
    print("📋 Endpoints:")
    print("   POST /embed/text    - Single text embedding (cached)")
    print("   POST /embed/batch   - Batch embeddings (cached)")
    print("   POST /similarity    - Text similarity (cached)")
    print("   GET  /health        - Health check")
    print("   POST /cache/clear   - Clear cache")
    print("   GET  /cache/stats   - Cache statistics")
    print(f"💾 Cache size limit: {MAX_CACHE_SIZE} embeddings")
    
    # Use production server for better performance
    try:
        from waitress import serve
        serve(app, host="127.0.0.1", port=5001, threads=8)  # Increased threads
    except ImportError:
        logger.warning("⚠️ Waitress not installed, using Flask dev server")
        app.run(host="127.0.0.1", port=5001, threaded=True)