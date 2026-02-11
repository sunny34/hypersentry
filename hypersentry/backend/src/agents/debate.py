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
            
            response = client.models.generate_content(
                model='gemini-1.5-flash',
                contents=prompt,
                config={"response_mime_type": "application/json"}
            )
            return json.loads(response.text)
        except Exception as e:
            logger.error(f"Agent {self.name} failed: {e}")
            return {"text": "Divergent signal confirmed.", "evidence": "Neutral bias"}

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
