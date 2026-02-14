import re
from typing import List, Dict, Any
import difflib

class IntelFilter:
    """
    Filters incoming intelligence to remove noise, spam, and duplicates.
    Ensures only high-quality, unique signals reach the user.
    """

    # Keywords that indicate low-value, clickbait, or spam content
    SPAM_KEYWORDS = [
        r"price analysis", r"price prediction", r"price forecast",
        r"how to buy", r"where to buy",
        r"sponsored", r"promoted", r"press release",
        r"top \d+ altcoins", r"top \d+ crypto",
        r"market wrap", r"daily recap",
        r"guest post", r"partner content",
        r"will shiba inu", r"can dogecoin", # Meme coin clickbait specific
        r"why is .* down", r"why is .* up", # Generic explaining
        r"technical analysis", 
    ]

    def __init__(self):
        self.seen_titles = [] # Keep a small buffer of recent titles for deduplication

    def filter(self, items: List[Dict[str, Any]], recent_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Main filtering pipeline:
        1. Spam/Noise check
        2. Deduplication check
        """
        filtered = []
        
        # Update seen titles from recent_items (persistence awareness)
        existing_titles = [item.get("title", "").lower() for item in recent_items]
        
        for item in items:
            title = item.get("title", "").strip()
            if not title:
                continue

            # 1. Spam Check
            if self._is_spam(title, item.get("content", "")):
                continue

            # 2. Deduplication Check
            if self._is_duplicate(title, existing_titles):
                continue

            # Passed checks
            filtered.append(item)
            existing_titles.append(title.lower()) # Add to local check to prevent dupes within the same batch

        return filtered

    def _is_spam(self, title: str, content: str) -> bool:
        """Check if content matches spam patterns."""
        text = (title + " " + content).lower()
        
        for pattern in self.SPAM_KEYWORDS:
            if re.search(pattern, text):
                return True
        return False

    def _is_duplicate(self, title: str, existing_titles: List[str]) -> bool:
        """Check if a similar title already exists."""
        title_lower = title.lower()
        
        # Exact match
        if title_lower in existing_titles:
            return True

        # Fuzzy match (Levenshtein distance)
        # Verify against last 50 items for efficiency
        for existing in existing_titles[:50]:
            similarity = difflib.SequenceMatcher(None, title_lower, existing).ratio()
            if similarity > 0.85: # 85% similarity threshold
                return True
                
        return False
