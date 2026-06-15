import os
import io
import json
import pdfplumber
import anthropic
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB


SCRIPT_PROMPT = """You are converting a dense financial research report into a spoken podcast script.

Rules:
- Write for ears, not eyes. No bullet points, no headers, no markdown.
- Write in continuous flowing paragraphs as a single confident analyst narrator.
- Target ~4,500 words (roughly 20 minutes at a natural speaking pace of ~220 wpm).
- Open with a compelling 2-sentence hook that states the key takeaway.
- Then work through the research logically: context → findings → implications → conclusion.
- Translate jargon into plain English. Spell out all numbers ("forty-two percent", not "42%").
- End with a crisp 3-sentence summary of what the listener should take away.
- Do NOT say "in this report" or "the PDF says" — speak as if you're the analyst.
- Do NOT include any stage directions, speaker labels, or formatting cues.

Here is the research report text:

{text}

Write the podcast script now:"""


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/extract", methods=["POST"])
def extract():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "File must be a PDF"}), 400

    try:
        pdf_bytes = f.read()
        text_parts = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
        full_text = "\n\n".join(text_parts)
        if not full_text.strip():
            return jsonify({"error": "Could not extract text from PDF"}), 400
        return jsonify({"text": full_text, "pages": len(pdf.pages)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json()
    api_key = data.get("api_key", "").strip()
    text = data.get("text", "").strip()

    if not api_key:
        return jsonify({"error": "Anthropic API key is required"}), 400
    if not text:
        return jsonify({"error": "No text provided"}), 400

    # Trim to ~100k chars to stay within context limits
    text = text[:100_000]

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=6000,
            messages=[
                {
                    "role": "user",
                    "content": SCRIPT_PROMPT.format(text=text),
                }
            ],
        )
        script = message.content[0].text
        return jsonify({"script": script})
    except anthropic.AuthenticationError:
        return jsonify({"error": "Invalid API key. Check your Anthropic API key."}), 401
    except anthropic.RateLimitError:
        return jsonify({"error": "Rate limit hit. Wait a moment and try again."}), 429
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
