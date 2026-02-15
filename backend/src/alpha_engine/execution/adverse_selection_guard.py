from datetime import datetime

class AdverseSelectionGuard:
    """
    Real-time market microstructure checks to cancel/hold orders.
    Prevents execution into a collapsing book or against strong flow (toxic flow).
    """

    def check(self,
        current_spread_bps: float,
        book_imbalance_ratio: float, # Bid Vol / Ask Vol (0-10+)
        recent_sweep_detected: bool,
        liquidity_available_usd: float
    ) -> bool:
        """
        Returns True if execution is SAFE.
        Returns False if adverse selection risk is detected.
        """
        
        # 1. Spread Check
        # If spread blows out > 20bps on major pair, market is broken/toxic.
        if current_spread_bps > 20.0:
            return False
            
        # 2. Imbalance Check (Order Book Flip)
        # If we are BUYING, and Ask side is huge relative to Bids (Sell Pressure),
        # or Bids are vanishing (pulling liquidity), wait.
        # Imbalance Ratio < 0.2 means Ask side is dominant 5:1
        if book_imbalance_ratio < 0.1 or book_imbalance_ratio > 10.0:
            return False
            
        # 3. Sweep Check
        if recent_sweep_detected:
            return False
            
        # 4. Liquidity Ghosting
        if liquidity_available_usd < 1000.0: # Minimum viable book
            return False
            
        return True
