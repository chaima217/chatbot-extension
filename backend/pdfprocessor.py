#pdfprocessor.py
import fitz  # PyMuPDF
import os
import json
from PIL import Image
from sentence_transformers import SentenceTransformer, util

# Load models
text_model = SentenceTransformer("all-MiniLM-L6-v2")
image_model = SentenceTransformer("clip-ViT-B-32") #model for images

def get_text_embedding(text):
    """Generate embedding for text."""
    if not text.strip():
        return None
    emb = text_model.encode(text, convert_to_tensor=True, normalize_embeddings=True)
    return emb.cpu().tolist()

def get_image_embedding(image_path):
    """Generate embedding for an image."""
    try:
        image = Image.open(image_path).convert("RGB")
        emb = image_model.encode(image, convert_to_tensor=True, normalize_embeddings=True)
        return emb.cpu().tolist()
    except Exception as e:
        print(f"❌ Failed to generate image embedding for {image_path}: {e}")
        return None

# Constants
PDF_DIR = "pdfs"
OUTPUT_JSON = "output.json"
IMAGE_DIR = "uploads/images"

def process_pdfs():
    """Process PDFs, extract text and images, generate embeddings."""
    knowledge_base = []
    os.makedirs(IMAGE_DIR, exist_ok=True)

    if not os.path.exists(PDF_DIR):
        print(f"❌ PDF directory not found: {PDF_DIR}")
        return knowledge_base

    pdf_files = [f for f in os.listdir(PDF_DIR) if f.lower().endswith(".pdf")]
    if not pdf_files:
        print(f"ℹ️ No PDF files found in: {PDF_DIR}")
        return knowledge_base

    print(f"🔍 Found {len(pdf_files)} PDFs to process...")
    global_page_counter = 1

    for pdf_file in pdf_files:
        pdf_path = os.path.join(PDF_DIR, pdf_file)
        print(f"\n📂 Processing: {pdf_file}")

        try:
            doc = fitz.open(pdf_path)
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                images = []

                # Extract images
                for img_index, img in enumerate(page.get_images(full=True)):
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_ext = base_image["ext"]
                    image_filename = f"doc{len(knowledge_base) + 1}_page{global_page_counter}_img{img_index + 1}.{image_ext}"
                    image_path = os.path.join(IMAGE_DIR, image_filename)

                    with open(image_path, "wb") as img_file:
                        img_file.write(base_image["image"])

                    # Generate image embedding
                    img_embedding = get_image_embedding(image_path)

                    # Add URL field for serving via Express
                    img_url = f"/images/{image_filename}"

                    images.append({
                        "filename": image_filename,
                        "url": img_url,            # <-- added this line
                        "width": base_image["width"],
                        "height": base_image["height"],
                        "xref": xref,
                        "embedding": img_embedding
                    })

                # Generate text embedding
                text_embedding = get_text_embedding(text)
                print(f"  📄 Page {global_page_counter}: {'✅' if text_embedding else '⚠️'} Text ({len(text)} chars), {len(images)} images")

                knowledge_base.append({
                    "document": pdf_file,
                    "page_number": global_page_counter,
                    "text": text,
                    "text_embedding": text_embedding,
                    "images": images
                })

                global_page_counter += 1

        except Exception as e:
            print(f"❌ Error processing {pdf_file}: {e}")

    return knowledge_base

if __name__ == "__main__":
    knowledge_base = process_pdfs()

    # Save to JSON
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(knowledge_base, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 Knowledge base created with {len(knowledge_base)} pages!")
    print(f"  - Text/embeddings: {OUTPUT_JSON}")
    print(f"  - Extracted images: {IMAGE_DIR}")
