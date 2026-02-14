
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
    print("Listing available models...")
    # The SDK method might vary, usually it's list_models() 
    # but the new google-genai SDK is a bit different from google-generativeai.
    # Let's try the standard client.models.list() if available or similar.
    
    # In the new google-genai SDK (v0.x or v1.x), it's often client.models.list()
    # We'll try to iterate.
    
    for m in client.models.list():
        print(f"Name: {m.name}")
        print(f"  DisplayName: {m.display_name}")
        print(f"  SupportedMethods: {m.supported_generation_methods}")
        print("-" * 20)

except Exception as e:
    print(f"Error listing models: {e}")
    # Fallback only if the new SDK fails, try the old one just in case 
    # (though previous context says we updated to google-genai)
