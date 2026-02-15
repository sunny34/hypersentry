import asyncio
import logging
import datetime
import httpx
from typing import List, Dict, Any, Optional
from .base import IntelProvider

logger = logging.getLogger(__name__)

class WorldMonitorProvider(IntelProvider):
    """
    Intelligence provider for WorldMonitor API.
    Fetches real-time geopolitical conflict, infrastructure outages, and global signals.
    """
    def __init__(self):
        super().__init__("worldmonitor")
        self.base_url = "https://worldmonitor.app/api"
        # Since the server has a CORS policy but allows direct backend requests
        self.headers = {
            "User-Agent": "HyperSentry-Alpha-Engine/1.0",
            "Accept": "application/json"
        }

    async def fetch_latest(self) -> List[Dict[str, Any]]:
        """Fetch latest alerts from multiple WorldMonitor endpoints."""
        endpoints = {
            "acled-conflict": "Geopolitical Alert",
            "ucdp": "Conflict Data",
            "cloudflare-outages": "Infrastructure Status"
        }
        
        tasks = [self._fetch_endpoint(ep, label) for ep, label in endpoints.items()]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        all_items = []
        for res in results:
            if isinstance(res, list):
                all_items.extend(res)
            elif isinstance(res, Exception):
                logger.error(f"WorldMonitor fetch error: {res}")
                
        return all_items

    async def _fetch_endpoint(self, endpoint: str, label: str) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/{endpoint}"
        params = {"limit": 10}
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params, headers=self.headers)
                if response.status_code != 200:
                    logger.warning(f"WorldMonitor {endpoint} failed with status {response.status_code}")
                    return []
                
                data = response.json()
                items = []
                
                # WorldMonitor responses vary slightly by endpoint
                if isinstance(data, list):
                    for raw in data:
                        normalized = self._normalize_item(raw, endpoint, label)
                        if normalized:
                            items.append(normalized)
                elif isinstance(data, dict) and "data" in data:
                    for raw in data["data"]:
                        normalized = self._normalize_item(raw, endpoint, label)
                        if normalized:
                            items.append(normalized)
                            
                return items
        except Exception as e:
            logger.error(f"Failed to fetch from WorldMonitor {endpoint}: {e}")
            return []

    def _normalize_item(self, raw: Dict[str, Any], endpoint: str, label: str) -> Optional[Dict[str, Any]]:
        try:
            # Generate a unique ID for this specific event
            # ACLED usually has 'event_id_no' or 'id'
            # UCDP has 'id'
            raw_id = str(raw.get("id") or raw.get("event_id_no") or raw.get("key") or hash(str(raw)))
            
            # Extract content & title
            title = f"[{label}] {raw.get('event_type') or raw.get('type') or 'Update'}"
            if endpoint == "cloudflare-outages":
                title = f"[{label}] {raw.get('location') or 'Global'} Outage Detected"
                content = f"Internet/Infrastructure outage in {raw.get('location')}. Impact: {raw.get('impact')}"
            else:
                country = raw.get('country') or raw.get('location') or 'Unknown'
                content = f"{raw.get('notes') or raw.get('description') or 'No description available.'} (Location: {country})"
            
            # Timestamp parsing
            ts_str = raw.get("event_date") or raw.get("timestamp") or raw.get("date")
            if ts_str:
                try:
                    # Basic ISO parsing, fallback to now
                    import dateutil.parser
                    ts = dateutil.parser.isoparse(str(ts_str))
                except:
                    ts = datetime.datetime.now(datetime.timezone.utc)
            else:
                ts = datetime.datetime.now(datetime.timezone.utc)

            url = raw.get("url") or f"https://worldmonitor.app"
            
            # Map impact levels
            # WorldMonitor uses 'fatalities' in ACLED or 'impact' in cloudflare
            is_high_impact = False
            fatalities = raw.get("fatalities")
            if fatalities and str(fatalities).isdigit() and int(fatalities) > 0:
                is_high_impact = True
            if raw.get("impact") in ["critical", "high"]:
                is_high_impact = True

            return self.normalize(
                raw_id=f"{endpoint}_{raw_id}",
                title=title,
                content=content,
                url=url,
                timestamp=ts,
                metadata={
                    "original_source": endpoint,
                    "location": raw.get("location") or raw.get("country"),
                    "category": label,
                    "raw_data": raw
                }
            )
        except Exception as e:
            logger.error(f"Error normalizing WorldMonitor item: {e}")
            return None
