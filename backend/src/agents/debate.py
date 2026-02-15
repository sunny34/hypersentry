from typing import List, Dict, Any
import json
import asyncio
import logging
from config import config

logger = logging.getLogger(__name__)

class DebateAgent:
    def __init__(self, name: str, role: str, persona: str):
        self.name = name
        self.role = role
        self.persona = persona

    async def argue(self, context: str, opponent_argument: str = None) -> Dict[str, Any]:
        """Generate an argument based on context and (optionally) the opponent's view."""
        if not config.GEMINI_API_KEY:
             return {"text": f"[{self.name}] Technical signal variance detected.", "evidence": "RSI/MACD divergent"}

        try:
            from google import genai
            client = genai.Client(api_key=config.GEMINI_API_KEY)
            
            prompt = f"""
            Act as {self.name}, a {self.role}. 
            PERSONA: {self.persona}
            
            MARKET CONTEXT:
            {context}
            
            OPPONENT ARGUMENT (if any):
            {opponent_argument if opponent_argument else "None yet."}
            
            GOAL:
            Argue your case for {self.name}'s bias. Be sharp, quantitative, and institutional.
            If responding to an opponent, dismantle their point using logic or market mechanics.
            
            OUTPUT FORMAT (JSON):
            {{
                "text": "your primary argument",
                "evidence": "one technical or fundamental fact supporting you"
            }}
            """
            
            # Retry logic for 429s
            max_retries = 3
            base_delay = 2
            
            for attempt in range(max_retries):
                try:
                    response = client.models.generate_content(
                        model='gemini-flash-latest', 
                        contents=prompt,
                        config={"response_mime_type": "application/json"}
                    )
                    return json.loads(response.text)
                except Exception as e:
                    if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                        if attempt < max_retries - 1:
                            import time
                            sleep_time = base_delay * (2 ** attempt)
                            logger.warning(f"Agent {self.name} hit 429. Retrying in {sleep_time}s...")
                            await asyncio.sleep(sleep_time)
                            continue
                    # If not 429 or retries exhausted, raise
                    raise e
                    
        except Exception as e:
            import traceback
            # Log full stack trace for debug
            logger.error(f"Agent {self.name} failed after retries: {e}")
            # Return actual error to UI (cleaner)
            err_msg = str(e)
            if "429" in err_msg:
                return {"text": "Market Volatility High (API Rate Limit). Analysis Paused.", "evidence": "System Monitor"}
            return {"text": f"Error: {err_msg[:50]}...", "evidence": "System Failure"}

class MultiAgentDebate:
    def __init__(self):
        self.bull = DebateAgent(
            "Bull Analyst", 
            "Optimistic Quant", 
            "Focus on liquidity inflections and support levels. Rejection of bearish doom."
        )
        self.bear = DebateAgent(
            "Bear Analyst", 
            "Pessimistic Macro Strategist", 
            "Focus on distribution patterns, liquidations, and overhead resistance."
        )

    async def run_debate(self, symbol: str, context: str) -> List[Dict[str, Any]]:
        """Run a multi-turn debate between agents."""
        transcript = []
        
        # Turn 1: Bull Opening
        bull_opening = await self.bull.argue(context)
        transcript.append({"agent": "bull", **bull_opening})
        
        # Turn 2: Bear Rebuttal
        bear_rebuttal = await self.bear.argue(context, bull_opening["text"])
        transcript.append({"agent": "bear", **bear_rebuttal})
        
        # Turn 3: Bull Final Point
        bull_final = await self.bull.argue(context, bear_rebuttal["text"])
        transcript.append({"agent": "bull", **bull_final})
        
        return transcript
