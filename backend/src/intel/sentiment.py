from google import genai
import logging
import os
import asyncio
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class SentimentAnalyzer:
    """
    Analyzes financial news sentiment using Google's Gemini Flash model.
    Categorizes input text as 'bullish', 'bearish', or 'neutral' with a confidence score.
    """
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            logger.warning("GEMINI_API_KEY not found. Sentiment analysis will be skipped.")
            self.client = None
        else:
            try:
                # Initialize the new Google GenAI client
                self.client = genai.Client(api_key=self.api_key)
                self.model_id = 'gemini-flash-latest' 
                logger.info("✅ Gemini Flash Latest initialized via google-genai SDK.")
            except ImportError:
                logger.warning("google-genai not installed. Sentiment analysis disabled.")
                self.client = None
            except Exception as e:
                logger.error(f"Failed to initialize Gemini Client: {e}")
                self.client = None

    async def analyze_batch(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Analyzes a batch of news items in parallel.
        Modifies the items in-place with 'sentiment' and 'sentiment_score'.
        """
        if not self.client or not items:
            return items

        # Only process items that are currently 'neutral' (default from providers)
        # or lack clear sentiment tagging
        to_analyze = [item for item in items if item.get("sentiment", "neutral") == "neutral"]
        
        if not to_analyze:
            return items

        tasks = [self._analyze_single(item) for item in to_analyze]
        # Run all analysis tasks concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Merge results back (in-place modification happened in _analyze_single)
        # But we handle exceptions just in case
        for i, res in enumerate(results):
            if isinstance(res, Exception):
                logger.warning(f"Sentiment analysis failed for item {to_analyze[i].get('id')}: {res}")
        
        return items

    async def _analyze_single(self, item: Dict[str, Any]):
        """
        Analyzes a single news item using Gemini.
        """
        try:
            prompt = f"""
            Analyze the financial sentiment of this crypto news headline/snippet for the specific token mentioned.
            
            Headline: "{item.get('title', '')}"
            Content: "{item.get('content', '')}"
            
            Return ONLY one word: BULLISH, BEARISH, or NEUTRAL.
            Consider:
            - Partnerships, adoption, upgrades -> BULLISH
            - Hacks, bans, lawsuits, delays -> BEARISH
            - General updates, education -> NEUTRAL
            """
            
            # Use the new client to generate content
            response = await asyncio.get_event_loop().run_in_executor(
                None, 
                lambda: self.client.models.generate_content(
                    model=self.model_id,
                    contents=prompt
                )
            )
            
            sentiment_raw = response.text.strip().upper()
            
            # Map to system format
            if "BULLISH" in sentiment_raw:
                item["sentiment"] = "bullish"
                item["sentiment_score"] = 0.9
            elif "BEARISH" in sentiment_raw:
                item["sentiment"] = "bearish"
                item["sentiment_score"] = -0.9
            else:
                item["sentiment"] = "neutral"
                item["sentiment_score"] = 0.0
                
        except Exception as e:
            # Fallback to simple keyword matching if API fails
            logger.debug(f"Gemini analysis failed: {e}. Falling back to keywords.")
            self._keyword_fallback(item)

    def _keyword_fallback(self, item: Dict[str, Any]):
        text = (item.get("title", "") + " " + item.get("content", "")).upper()
        
        bullish_terms = ["PARTNERSHIP", "LAUNCH", "GROWTH", "RECORD", "ALL-TIME HIGH", "GULLISH", "COMPLETED", "SUCCESS", "UPGRADE"]
        bearish_terms = ["HACK", "STOLEN", "BAN", "LAWSUIT", "CRASH", "DOWN", "DELAY", "FAILED", "VULNERABILITY"]
        
        score = 0
        for term in bullish_terms:
            if term in text: score += 1
        for term in bearish_terms:
            if term in text: score -= 1
            
        if score > 0:
            item["sentiment"] = "bullish"
        elif score < 0:
            item["sentiment"] = "bearish"
        else:
            item["sentiment"] = "neutral"
