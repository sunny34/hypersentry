import pytest
import asyncio
from unittest.mock import MagicMock

# Mocking the dependencies
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

@pytest.fixture
def mock_exchange():
    exchange = MagicMock()
    exchange.coin_to_asset.return_value = 0
    return exchange

@pytest.fixture
def client_with_mock_exchange(mock_exchange):
    from src.client_wrapper import HyperliquidClient
    client = HyperliquidClient()
    client.exchange = mock_exchange
    client.market_open = MagicMock(return_value={"status": "ok", "oid": 123})
    return client

def test_managed_trade_execution_flow(client_with_mock_exchange, mock_exchange):
    """
    Test that managed_trade correctly places a market order 
    followed by TP and SL orders.
    """
    # Setup
    coin = "ETH"
    is_buy = True
    sz = 1.0
    tpPrice = 3000.0
    slPrice = 2500.0
    
    # Execute
    res = asyncio.run(
        client_with_mock_exchange.managed_trade(
            coin=coin,
            is_buy=is_buy,
            sz=sz,
            tp=tpPrice,
            sl=slPrice,
        )
    )
    
    # Assert primary order
    client_with_mock_exchange.market_open.assert_called_once_with(coin, is_buy, sz)
    
    # Assert TP/SL orders (2 calls to exchange.order)
    assert mock_exchange.order.call_count == 2
    
    # Verify TP order details
    tp_call = mock_exchange.order.call_args_list[0][0][0]
    assert tp_call["limitPx"] == tpPrice
    assert tp_call["orderType"]["trigger"]["tpsl"] == "tp"
    assert tp_call["reduceOnly"] is True
    
    # Verify SL order details
    sl_call = mock_exchange.order.call_args_list[1][0][0]
    assert sl_call["limitPx"] == slPrice
    assert sl_call["orderType"]["trigger"]["tpsl"] == "sl"
    assert sl_call["reduceOnly"] is True
    
    assert res["status"] == "ok"

def test_managed_trade_failure_propagation(client_with_mock_exchange):
    """
    Test that if the primary market order fails, 
    TP/SL orders are NOT placed.
    """
    # Setup - simulate primary failure
    client_with_mock_exchange.market_open.return_value = {"status": "err", "response": "Insufficient margin"}
    
    # Execute
    res = asyncio.run(client_with_mock_exchange.managed_trade("BTC", True, 0.1, 100000, 50000))
    
    # Assert
    assert client_with_mock_exchange.exchange.order.call_count == 0
    assert res["status"] == "err"
    assert "Primary order failed" in res["message"]
