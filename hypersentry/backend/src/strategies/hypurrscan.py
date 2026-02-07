import aiohttp
import logging
from typing import List, Dict, Optional

logger = logging.getLogger("HypurrScan")

class HypurrScan:
    BASE_URL = "https://api.hypurrscan.io"
    
    def __init__(self):
        self.session = None

    async def _get_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session

    async def get_active_twaps(self, token: str) -> List[Dict]:
        """Fetch active TWAPs for a specific token."""
        url = f"{self.BASE_URL}/twap/{token}"
        try:
            session = await self._get_session()
            async with session.get(url) as resp:
                if resp.status != 200:
                    logger.error(f"Failed to fetch TWAPs for {token}: {resp.status}")
                    return []
                
                data = await resp.json()
                # Filter for active (no 'ended' status or ended is null)
                active = [
                    x for x in data 
                    if x.get('action', {}).get('type') == 'twapOrder' 
                    and not x.get('ended')
                ]
                return active
        except Exception as e:
            logger.error(f"Error fetching from HypurrScan: {e}")
            return []

    async def close(self):
        if self.session:
            await self.session.close()
