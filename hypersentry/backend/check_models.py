
import os
from google import genai
from config import config

# Ensure API Key is loaded
if not config.GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not found in config.")
    exit(1)

print(f"Using API Key: {config.GEMINI_API_KEY[:5]}...{config.GEMINI_API_KEY[-5:]}")

try:
    client = genai.Client(api_key=config.GEMINI_API_KEY)
    print("Listing ALL available models:")
    for m in client.models.list():
        # Print just the name to keep it clean but show ALL
        print(m.name)

except Exception as e:
    print(f"Error listing models: {e}")
