
# 2026-02-10: Microstructure Revamp (ExitPump Style)

## Context
Based on the analysis of @exitpumpBTC's trading strategy, the Microstructure module has been fully revamped to focus on **Order Flow Context**.

## Changes

### 1. Backend (`backend/src/intel/providers/microstructure.py`)
*   **Open Interest Integration**: Now fetches aggregated OI (Binance Futures) to pair with CVD.
*   **Passive Supply Scanner**: Scans the Binance Spot Orderbook for large limit walls (>15 BTC) and returns them as `depth_walls`.
*   **Divergence Engine**: Implements a detection logic (`_check_divergence`) that compares Price slope vs. CVD slope over the last 15 minutes to identify Bearish/Bullish absorption.

### 2. Frontend (`web/app/intel/microstructure/page.tsx`)
*   **Regime Banner**: A new top-level component that displays the current Market Regime (e.g., "BULLISH CVD", "Equilibrium") and the nearest **Passive Supply Wall**.
*   **New Charts**:
    *   **Price Chart**: Overlays "Passive Supply Walls" as horizontal reference lines (visualized via text/data for now).
    *   **Net CVD**: Split into its own dedicated chart for cleaner divergence spotting.
    *   **Open Interest**: Added a specific area chart for OI tracking at the bottom.
*   **Interpretation**: Updated the sidebar to provide actionable signals based on the new Divergence and Wall data.

### 3. Integrated Terminal HUD (`web/app/terminal/page.tsx`)
*   **Floating Intel Dock**: Created a draggable `MicrostructureHUD` widget that floats over the main trading terminal.
*   **Toggle Integration**: Added a "Intel HUD" button to the top terminal bar for quick access without leaving the charts.
*   **Real-time Data**: The HUD streams the same institutional-grade data (CVD in Millions, OI in Billions, Nearest Wall) as the full dashboard.

## Impact
The dashboard now provides a professional-grade "Single Pane of Glass" for:
1.  **Absorption** (CVD Divergence)
2.  **Resistance** (Passive Limit Walls)
3.  **Positioning** (Open Interest Trends)
