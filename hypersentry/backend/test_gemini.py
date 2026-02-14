
import os
from dotenv import load_dotenv
import json

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
print(f"API Key: {api_key}")

try:
    from google import genai
    print("Successfully imported google.genai")
    
    client = genai.Client(api_key=api_key)
    print("Client created")

    print("Generating content...")
    
    prompt = "Return a JSON object with a 'message' key saying hello."
    
    response = client.models.generate_content(
        model='gemini-3-flash-preview',
        contents=prompt,
        config={"response_mime_type": "application/json"}
    )
    print(f"Response: {response.text}")
    
except Exception as e:
    print(f"Error: {e}")
