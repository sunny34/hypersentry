
from google import genai
from config import config

if not config.GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not found.")
    exit(1)

client = genai.Client(api_key=config.GEMINI_API_KEY)

try:
    print("Listing models...")
    for m in client.models.list():
        print(f"Model: {m.name}")
except Exception as e:
    print(f"Error: {e}")
