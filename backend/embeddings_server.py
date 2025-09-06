# embedding_server.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer, util
import numpy as np
import logging
import threading
import base64
from io import BytesIO
from PIL import Image

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global model variable with lazy loading
text_model = None
image_model = None
model_lock = threading.Lock()

def load_models():
    """Lazy load models only when needed"""
    global text_model, image_model
    with model_lock:
        if text_model is None:
            try:
                logger.info("⏳ Loading text embedding model...")
                text_model = SentenceTransformer("all-MiniLM-L6-v2")
                logger.info("✅ Text model loaded")
            except Exception as e:
                logger.error(f"❌ Failed to load text model: {e}")
                raise
        
        # Only load image model if needed (saves memory)
        if image_model is None:
            try:
                logger.info("⏳ Loading image model...")
                image_model = SentenceTransformer("clip-ViT-B-32")
                logger.info("✅ Image model loaded")
            except Exception as e:
                logger.warning(f"⚠️ Could not load image model: {e}")
                # Continue without image model

@app.before_request
def before_request():
    """Ensure models are loaded before handling requests"""
    if text_model is None:
        load_models()

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "healthy", 
        "text_model_loaded": text_model is not None,
        "image_model_loaded": image_model is not None
    })

@app.route("/embed/text", methods=["POST"])
def embed_text():
    """Generate embedding for text - with timeout"""
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "Missing 'text' in request body"}), 400
        
        text = data["text"].strip()
        if not text:
            return jsonify({"embedding": []})
        
        # Generate embedding with timeout protection
        embedding = text_model.encode(text, 
                                    convert_to_tensor=True, 
                                    show_progress_bar=False,
                                    normalize_embeddings=True)
        
        return jsonify({
            "embedding": embedding.cpu().tolist(),
            "dimensions": len(embedding),
            "model": "all-MiniLM-L6-v2"
        })
        
    except Exception as e:
        logger.error(f"Error in embed_text: {e}")
        return jsonify({"error": str(e)}), 500
    
@app.route("/embed/image", methods=["POST"])
def embed_image():
    """Generate embedding for an uploaded image."""
    if image_model is None:
        return jsonify({"error": "Image model not loaded"}), 500

    try:
        data = request.get_json()
        if not data or "image_base64" not in data:
            return jsonify({"error": "Missing 'image_base64' in request body"}), 400

        image_data = base64.b64decode(data["image_base64"])
        image = Image.open(BytesIO(image_data)).convert("RGB")

        embedding = image_model.encode(image, convert_to_tensor=True, normalize_embeddings=True)
        return jsonify({
            "embedding": embedding.cpu().tolist(),
            "dimensions": len(embedding),
            "model": "clip-ViT-B-32"
        })

    except Exception as e:
        logger.error(f"Error in embed_image: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/embed/batch", methods=["POST"])
def embed_batch():
    """Generate embeddings for multiple texts - optimized"""
    try:
        data = request.get_json()
        if not data or "texts" not in data:
            return jsonify({"error": "Missing 'texts' array"}), 400
        
        texts = [t.strip() for t in data["texts"] if t.strip()]
        if not texts:
            return jsonify({"embeddings": []})
        
        # Batch processing with optimization
        embeddings = text_model.encode(texts, 
                                     convert_to_tensor=True,
                                     show_progress_bar=False,
                                     batch_size=32,  # Optimized batch size
                                     normalize_embeddings=True)
        
        return jsonify({
            "embeddings": embeddings.cpu().tolist(),
            "count": len(texts),
            "dimensions": embeddings.shape[1]
        })
        
    except Exception as e:
        logger.error(f"Error in embed_batch: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/similarity", methods=["POST"])
def calculate_similarity():
    """Calculate similarity between two texts"""
    try:
        data = request.get_json()
        if not data or "text1" not in data or "text2" not in data:
            return jsonify({"error": "Missing texts"}), 400
        
        text1 = data["text1"].strip()
        text2 = data["text2"].strip()
        
        if not text1 or not text2:
            return jsonify({"error": "Texts cannot be empty"}), 400
        
        # Get embeddings
        emb1 = text_model.encode(text1, convert_to_tensor=True, show_progress_bar=False)
        emb2 = text_model.encode(text2, convert_to_tensor=True, show_progress_bar=False)
        
        # Calculate similarity
        similarity = util.pytorch_cos_sim(emb1, emb2).item()
        
        return jsonify({
            "similarity": float(similarity),
            "text1": text1,
            "text2": text2
        })
        
    except Exception as e:
        logger.error(f"Error in similarity: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("🚀 Starting Embedding Server on http://127.0.0.1:5001")
    print("📋 Endpoints:")
    print("   POST /embed/text    - Single text embedding")
    print("   POST /embed/batch   - Batch embeddings")
    print("   POST /similarity    - Text similarity")
    print("   GET  /health        - Health check")
    
    # Use production server for better performance
    from waitress import serve
    serve(app, host="127.0.0.1", port=5001, threads=4)