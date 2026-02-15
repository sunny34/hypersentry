import httpx
import logging
import datetime
from typing import List, Dict, Any
from .base import IntelProvider

logger = logging.getLogger(__name__)

class PolymarketProvider(IntelProvider):
    """
    Fetches real-time prediction market data from Polymarket.
    Provides macro sentiment and event probabilities.
    """
    def __init__(self):
        super().__init__("Polymarket")
        self.base_url = "https://gamma-api.polymarket.com"
        # Tag 1006 is typically Crypto, but we'll also look at macro (politics/econ might affect crypto)
        self.crypto_tag_id = 1006
        self.client = httpx.AsyncClient(timeout=10.0)

    async def fetch_latest(self) -> List[Dict[str, Any]]:
        """
        Fetch latest active macro markets from Polymarket.
        Scans for Politics, Geo-politics, and Economics in addition to Crypto.
        """
        try:
            # Fetch active events sorted by volume to get high-impact first
            params = {
                "active": "true",
                "closed": "false",
                "limit": 100,
                # Fetch more events to ensure we don't miss dated mini-markets
            }
            
            # Use aggressive headers to mimic a browser and avoid regional blocks
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "application/json"
            }
            
            response = await self.client.get(f"{self.base_url}/events", params=params)
            response.raise_for_status()
            events = response.json()
            
            normalized_items = []
            for event in events:
                markets = event.get("markets", [])
                if not markets:
                    continue
                
                market = markets[0]
                import json
                
                try:
                    outcomes = market.get("outcomes", [])
                    if isinstance(outcomes, str):
                        outcomes = json.loads(outcomes)
                        
                    outcome_prices = market.get("outcomePrices", [])
                    if isinstance(outcome_prices, str):
                        outcome_prices = json.loads(outcome_prices)
                except Exception as je:
                    continue
                
                if len(outcomes) < 2 or len(outcome_prices) < 2:
                    continue

                yes_prob = float(outcome_prices[0]) * 100
                
                title = event.get("title", "Unknown Event")
                description = event.get("summary", event.get("description", ""))
                url = f"https://polymarket.com/event/{event.get('slug')}"
                
                # Determine category based on title/tags
                category = "Macro"
                lower_title = title.lower()
                if any(x in lower_title for x in ["btc", "eth", "crypto", "bitcoin", "ethereum", "solana"]):
                    category = "Crypto"
                elif any(x in lower_title for x in ["election", "trump", "biden", "harris", "president", "senate", "governor"]):
                    category = "Politics"
                elif any(x in lower_title for x in ["fed", "rate", "inflation", "cpi", "fomc", "powell"]):
                    category = "Economics"
                elif any(x in lower_title for x in ["war", "invade", "attack", "conflict", "military", "strike", "iran", "russia", "china", "ukraine", "taiwan", "israel", "hezbollah", "houthi"]):
                    category = "Geo-Political"

                # Flag high-impact / "Suspicious" spikes or extreme odds
                is_high_impact = False
                if any(x in lower_title for x in ["invade", "war", "nuclear", "default", "crisis"]):
                    is_high_impact = True
                if yes_prob > 95 or yes_prob < 5:
                    # Near certainty or impossibility triggers high-impact alert
                    is_high_impact = True
                
                content = f"[{category}] Market Odds: {yes_prob:.1f}% for 'YES'. {description}"
                
                sentiment = "bullish" if yes_prob > 60 else "bearish" if yes_prob < 40 else "neutral"
                
                normalized = self.normalize(
                    raw_id=str(event.get("id")),
                    title=f"Prediction: {title}",
                    content=content,
                    url=url,
                    timestamp=datetime.datetime.now(),
                    sentiment=sentiment
                )
                
                # Add extra prediction metadata
                normalized["is_high_impact"] = is_high_impact
                normalized["metadata"] = {
                    "probability": yes_prob,
                    "event_id": event.get("id"),
                    "market_id": market.get("id"),
                    "type": "prediction",
                    "category": category,
                    "volume": event.get("volume", 0)
                    # "suspicious": is_high_impact # Internal flag
                }
                
                normalized_items.append(normalized)
                
            # Sort by absolute impact and relevance
            normalized_items.sort(key=lambda x: (x.get("is_high_impact", False), x.get("metadata", {}).get("volume", 0)), reverse=True)
            
            # Log for debugging why we might miss things
            logger.info(f"🔮 Polymarket Engine parsed {len(normalized_items)} and identified {sum(1 for x in normalized_items if x.get('is_high_impact'))} high-impact events.")
            
            return normalized_items

        except Exception as e:
            logger.error(f"Polymarket fetch failed: {e}")
            return []

    async def fetch_markets_by_query(self, query: str) -> List[Dict[str, Any]]:
        """Specific helper for searching markets."""
        try:
            params = {"active": "true", "closed": "false", "q": query}
            response = await self.client.get(f"{self.base_url}/events", params=params)
            return response.json()
        except Exception as e:
            logger.error(f"Polymarket query failed: {e}")
            return []
