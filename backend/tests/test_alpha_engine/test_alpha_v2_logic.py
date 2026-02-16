import pytest
import asyncio
import time
from unittest.mock import MagicMock, AsyncMock, patch
from src.alpha_engine.services.alpha_service import AlphaService
from src.alpha_engine.processors.conviction_engine import ConvictionEngine
from src.alpha_engine.models.regime_models import AlphaSignal, MarketRegime, VolatilityRegime
from src.alpha_engine.models.liquidation_models import LiquidationProjectionResult
from src.alpha_engine.models.footprint_models import FootprintResult, ImpulseEvent, SweepEvent, AbsorptionEvent, FlowImbalanceResult
from src.alpha_engine.state.market_state import MarketState
from src.services.redis_service import redis_service

@pytest.fixture
def alpha_service():
    return AlphaService()

@pytest.mark.asyncio
async def test_conviction_engine_hysteresis():
    # Setup signals
    regime = AlphaSignal(
        symbol="BTC", 
        regime=MarketRegime.AGGRESSIVE_LONG_BUILD, 
        regime_confidence=0.5, 
        volatility_regime=VolatilityRegime.TRENDING,
        compression_score=0.5,
        timestamp=int(time.time()*1000)
    )
    liq = LiquidationProjectionResult(symbol="BTC", current_price=100, imbalance_ratio=1.0, dominant_side="BALANCED", upside={}, downside={})
    fp = FootprintResult(
        symbol="BTC", 
        impulse=ImpulseEvent(), 
        sweep=SweepEvent(), 
        absorption=AbsorptionEvent(), 
        imbalance=FlowImbalanceResult(imbalance_ratio=1.0, z_score=0.0, dominance="NEUTRAL"),
        timestamp=int(time.time()*1000)
    )
    
    # CASE 1: Score is 55 (Neutral territory). 
    # If prev_bias was LONG, it should stay LONG (Hysteresis)
    # If prev_bias was NEUTRAL, it should stay NEUTRAL
    
    # Mock scores to result in ~55
    # (regime_score * 0.25) + (liq_score * 0.25) + ...
    # Let's say raw_score is 0.1, scaling: (0.1 + 1) * 50 = 55
    
    with patch.object(ConvictionEngine, '_calculate_regime_score', return_value=(0.1, "test")):
        with patch.object(ConvictionEngine, '_calculate_liquidation_score', return_value=(0.1, "test")):
            with patch.object(ConvictionEngine, '_calculate_footprint_score', return_value=(0.1, "test")):
                with patch.object(ConvictionEngine, '_calculate_funding_score', return_value=(0.1, "test")):
                    with patch.object(ConvictionEngine, '_calculate_volatility_score', return_value=(0.1, "test")):
                        
                        # From NEUTRAL -> 55 should be NEUTRAL
                        res1 = ConvictionEngine.analyze("BTC", regime, liq, fp, 0.0, 0.0, 1.0, prev_bias="NEUTRAL")
                        assert res1.score == 55
                        assert res1.bias == "NEUTRAL"
                        
                        # From LONG -> 55 should stay LONG
                        res2 = ConvictionEngine.analyze("BTC", regime, liq, fp, 0.0, 0.0, 1.0, prev_bias="LONG")
                        assert res2.score == 55
                        assert res2.bias == "LONG"

                        # From SHORT -> 55 should flip to NEUTRAL (since 55 > 50)
                        res3 = ConvictionEngine.analyze("BTC", regime, liq, fp, 0.0, 0.0, 1.0, prev_bias="SHORT")
                        assert res3.score == 55
                        assert res3.bias == "NEUTRAL"

@pytest.mark.asyncio
async def test_alpha_service_dynamic_weights():
    service = AlphaService()
    
    # Set up Expansion Volatility
    vol_res = {"volatility_regime": "EXPANSION", "realized_vol": 0.05}
    fp_res = FootprintResult(
        symbol="BTC", 
        impulse=ImpulseEvent(), 
        sweep=SweepEvent(), 
        absorption=AbsorptionEvent(), 
        imbalance=FlowImbalanceResult(imbalance_ratio=1.0, z_score=0.0, dominance="NEUTRAL"),
        timestamp=int(time.time()*1000)
    )
    
    weights = service._calculate_dynamic_weights(vol_res, fp_res)
    
    # In Expansion, Liquidation weight should be higher
    assert weights["w_liquidation"] == 0.35
    assert weights["w_footprint"] == 0.30
    
    # Set up Aggression Spike
    fp_aggro = FootprintResult(
        symbol="BTC", 
        impulse=ImpulseEvent(event="BULLISH_IMPULSE", strength=2.0),
        sweep=SweepEvent(), 
        absorption=AbsorptionEvent(), 
        imbalance=FlowImbalanceResult(imbalance_ratio=1.0, z_score=0.0, dominance="NEUTRAL"),
        timestamp=int(time.time()*1000)
    )
    
    weights_aggro = service._calculate_dynamic_weights({"volatility_regime": "TRENDING"}, fp_aggro)
    # Footprint should be boosted
    assert weights_aggro["w_footprint"] > 0.25

@pytest.mark.asyncio
async def test_alpha_service_anchored_impulse(alpha_service):
    # Mock data store
    symbol = "BTC"
    now_ms = int(time.time() * 1000)
    
    # Inject history
    alpha_service.price_time_cache[symbol] = [
        (now_ms - 70000, 100.0), # 70s ago
        (now_ms - 60000, 100.0), # 60s ago (anchor)
        (now_ms - 30000, 105.0), # 30s ago
    ]
    alpha_service.cvd_time_cache[symbol] = [
        (now_ms - 70000, 0.0),
        (now_ms - 60000, 0.0), # Anchor
        (now_ms - 30000, 100000.0),
    ]
    
    from src.alpha_engine.state.market_state import MarketState
    state = MarketState(symbol=symbol, price=110.0, cvd_1m=200000.0, timestamp=now_ms)
    
    # The pipeline should find the anchor at 60s (price 100, cvd 0)
    # Impulse = (110 - 100) / 100 = 10% move and 200k CVD delta
    
    with patch('src.alpha_engine.services.alpha_service.global_state_store.get_state', new_callable=AsyncMock) as mock_get_state:
         mock_get_state.return_value = state
         
         # Test the search logic directly if possible, or mock processors
         with patch('src.alpha_engine.processors.oi_price_regime.OIRegimeClassifier.classify', return_value={"regime": "NEUTRAL", "confidence": 0.5}), \
              patch('src.alpha_engine.processors.volatility_regime.VolatilityDetector.detect', return_value={"volatility_regime": "TRENDING", "compression_score": 0.5}), \
              patch('src.alpha_engine.processors.liquidation_projection.LiquidationProjector.project', return_value=LiquidationProjectionResult(symbol="BTC", current_price=100, imbalance_ratio=1.0, dominant_side="BALANCED", upside={}, downside={})), \
              patch('src.alpha_engine.processors.sweep_detector.SweepDetector.detect', return_value=SweepEvent()), \
              patch('src.alpha_engine.processors.absorption_detector.AbsorptionDetector.detect', return_value=AbsorptionEvent()), \
              patch('src.alpha_engine.processors.flow_imbalance.FlowImbalanceProcessor.compute', return_value=FlowImbalanceResult(imbalance_ratio=1.0, z_score=0.0, dominance="NEUTRAL")), \
              patch('src.alpha_engine.processors.conviction_engine.ConvictionEngine.analyze', return_value=MagicMock()) as mock_conviction, \
              patch('src.alpha_engine.processors.impulse_detector.ImpulseDetector.detect', return_value=ImpulseEvent()) as mock_impulse:
                  
                  # We also need to mock probability_service, governance_service, risk_service, and execution_service
                  with patch('src.alpha_engine.services.alpha_service.probability_service.calculate_probabilities', return_value=MagicMock()), \
                       patch('src.alpha_engine.services.alpha_service.risk_service.calculate_risk', return_value=MagicMock()), \
                       patch('src.alpha_engine.services.alpha_service.execution_service.generate_plan', return_value=MagicMock()), \
                       patch('src.alpha_engine.services.alpha_service.get_governance_service', new_callable=AsyncMock) as mock_gov:
                           
                           mock_gov.return_value = MagicMock()
                           mock_gov.return_value.get_health_report.return_value = MagicMock()
                           
                           # Ensure conviction.bias is not NEUTRAL to trigger risk/exec paths if needed,
                           # but the test mostly care about anchored lookback
                           mock_conviction.return_value.bias = "LONG"
                           
                           await alpha_service._run_pipeline(symbol)
                  
                  # Check that prev_cvd and prev_p passed to ImpulseDetector are from 60s ago
                  args, kwargs = mock_impulse.call_args
                  # args[0] is state, args[1] is prev_cvd, args[2] is prev_p
                  assert args[1] == 0.0
                  assert args[2] == 100.0

@pytest.mark.asyncio
async def test_aggregator_cvd_persistence():
    from src.services.aggregator import DataAggregator
    agg = DataAggregator()
    
    # Mock Redis
    mock_redis = AsyncMock()
    mock_redis.hgetall.return_value = {"BTC": "1234.56", "ETH": "-500.0"}
    
    with patch('src.services.redis_service.redis_service._client', mock_redis):
        await agg._load_persisted_state()
        assert agg.cvd_data["BTC"] == 1234.56
        assert agg.cvd_data["ETH"] == -500.0

@pytest.mark.asyncio
async def test_redis_service_basic():
    # Test that it handles no-client gracefully
    with patch.object(redis_service, '_client', None):
        res = await redis_service.get("test")
        assert res is None
        
        ok = await redis_service.set("test", "val")
        assert ok is False
