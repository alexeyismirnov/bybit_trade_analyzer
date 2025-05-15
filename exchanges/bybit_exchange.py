import os
import ccxt
import time
from datetime import datetime

class BybitExchange:
    def __init__(self, api_key, api_secret, cache_manager):
        self.exchange = ccxt.bybit({
            'apiKey': api_key,
            'secret': api_secret,
            'enableRateLimit': True,
        })
        self.exchange.options['defaultType'] = 'swap'  # Set default market type to swap for perpetuals
        self.cache_manager = cache_manager

    def make_api_request(self, symbol=None, start_time=None, end_time=None):
        """Make a single API request using ccxt to fetch closed P&L"""
        try:
            ccxt_params = {
                'category': 'linear',
                'limit': 100
            }
            if symbol:
                ccxt_params['symbol'] = symbol
            if start_time:
                ccxt_params['startTime'] = int(start_time)
            if end_time:
                ccxt_params['endTime'] = int(end_time)
            
            # Using privateGetPositionClosedPnl to match the original endpoint
            data = self.exchange.privateGetV5PositionClosedPnl(ccxt_params)
            
            if data and data.get('retCode') == '0':
                result_data = data.get('result', {})
                trades_list = result_data.get('list', [])
                
                if not isinstance(trades_list, list):
                    print(f"Warning: 'list' in result is not a list. Actual type: {type(trades_list)}. Result: {result_data}")
                    trades_list = []
                
                if trades_list and self.cache_manager.is_cache_available():
                    self.cache_manager.cache_trades(trades_list, self.process_trade, 'bybit')
                
                return trades_list
            else:
                error_code = data.get('retCode', 'Unknown') if data else 'N/A'
                error_message = data.get('retMsg', 'Unknown error') if data else 'No response from API'
                
                log_msg = f"API Error (ccxt): {error_message} (Code: {error_code})"
                print(log_msg)
                if data:
                    print(f"Full error response from ccxt: {data}")
                return []
                
        except ccxt.NetworkError as e:
            print(f"CCXT Network Error in make_api_request for bybit: {str(e)}")
            return []
        except ccxt.ExchangeError as e:
            print(f"CCXT Exchange Error in make_api_request for bybit: {str(e)}")
            return []
        except Exception as e:
            print(f"Generic Error in make_api_request with ccxt for bybit: {str(e)}")
            return []

    def fetch_completed_trades(self, symbol=None, start_time=None, end_time=None):
        """Fetch completed trades from API, handling pagination and chunking"""
        all_trades = []
        
        # Start from the end_time and work backwards in 7-day chunks
        current_end = end_time
        current_start = max(current_end - (7 * 24 * 60 * 60 * 1000), start_time)  # 7 days in milliseconds or start_time
        
        # We'll make up to 20 requests to cover longer time periods
        max_requests = 20
        request_count = 0
        
        while current_start >= start_time and request_count < max_requests:
            # Fetch trades for this 7-day window
            batch_trades = self.make_api_request(symbol, current_start, current_end)
            
            # Add to our collection
            all_trades.extend(batch_trades)
            
            # Move to the next 7-day window
            current_end = current_start - 1
            current_start = max(current_end - (7 * 24 * 60 * 60 * 1000), start_time)
            
            # If we've reached the start_time, we're done
            if current_end <= start_time:
                break
                
            request_count += 1
            
            # Add a small delay between requests
            time.sleep(0.5)
        
        # Update cache ranges after fetching new data
        if all_trades and self.cache_manager.is_cache_available():
            self.cache_manager.update_cache_ranges(symbol, start_time, end_time, 'bybit')
        
        return all_trades

    def fetch_open_trades(self, symbol=None):
        """Fetch open positions from API using ccxt"""
        try:
            params = {'category': 'linear', 'settleCoin': 'USDT'}
            if symbol:
                params['symbol'] = symbol

            # Fetch positions
            positions = self.exchange.fetch_positions(symbols=[symbol] if symbol else None, params=params)
            
            open_trades = []
            for trade in positions:
                # Filter out positions with zero size (not truly open)
                if float(trade.get('contracts', 0) or trade.get('info', {}).get('size', 0)) == 0:
                    continue

                # Get values with appropriate fallbacks based on exchange
                unrealised_pnl = float(trade.get('unrealizedPnl', 0))
                contracts = float(trade.get('contracts', 0) or trade.get('info', {}).get('size', 0))
                mark_price = float(trade.get('markPrice', 0) or trade.get('info', {}).get('markPrice', 0))
                position_value = contracts * mark_price

                roi = 0
                if position_value != 0:
                    roi = (unrealised_pnl / position_value) * 100
                
                # Map ccxt fields to your existing structure
                open_trades.append({
                    'symbol': trade.get('symbol'),
                    'side': trade.get('side'),
                    'size': contracts,
                    'avgPrice': trade.get('entryPrice', trade.get('info', {}).get('avgPrice')),
                    'markPrice': mark_price,
                    'unrealisedPnl': unrealised_pnl,
                    'leverage': trade.get('leverage', trade.get('info', {}).get('leverage')),
                    'positionValue': position_value,
                    'roi': roi,
                    'updatedTime': trade.get('timestamp', int(time.time() * 1000)),
                    'liqPrice': trade.get('liquidationPrice', trade.get('info', {}).get('liqPrice')),
                    'positionIM': trade.get('initialMargin', trade.get('info', {}).get('positionIM')),
                    'positionMM': trade.get('maintenanceMargin', trade.get('info', {}).get('positionMM')),
                    'exchange': 'bybit'
                })
                
            return open_trades
        except ccxt.NetworkError as e:
            print(f"CCXT Network Error fetching open trades from bybit: {str(e)}")
            raise e
        except ccxt.ExchangeError as e:
            print(f"CCXT Exchange Error fetching open trades from bybit: {str(e)}")
            raise e
        except Exception as e:
            print(f"Generic Error fetching open trades with ccxt from bybit: {str(e)}")
            raise e

    def fetch_wallet_balance(self):
        """Fetch wallet balance from Bybit"""
        try:
            params = {'accountType': 'UNIFIED'}
            balance_data = self.exchange.fetch_balance(params=params)
            
            # Extract balance
            balance_value = None
            
            # For Bybit, look for USDT
            if 'USDT' in balance_data:
                balance_value = balance_data['USDT'].get('total')
            elif balance_data.get('info') and isinstance(balance_data['info'].get('list'), list):
                for account_info in balance_data['info']['list']:
                    if account_info.get('accountType') == 'UNIFIED':
                        for coin_info in account_info.get('coin', []):
                            if coin_info.get('coin') == 'USDT':
                                balance_value = coin_info.get('walletBalance')
                                break
                    if balance_value is not None:
                        break
            
            if balance_value is None and balance_data.get('total') and 'USDT' in balance_data['total']:
                balance_value = balance_data['total']['USDT']
                
            # Convert to float
            if balance_value is not None:
                try:
                    balance_value = float(balance_value)
                except (ValueError, TypeError):
                    print(f"Could not convert balance value to float: {balance_value}")
                    balance_value = 0
            
            return balance_value
        except Exception as e:
            print(f"Error fetching wallet balance from Bybit: {str(e)}")
            raise e

    def close_position(self, trade_data):
        """Close an open position on Bybit"""
        try:
            symbol = trade_data.get('symbol')
            side = trade_data.get('side')
            size = trade_data.get('size')
            # For Bybit, we might need positionIdx for unified margin accounts
            # position_idx = trade_data.get('positionIdx') # Assuming positionIdx is available in trade_data if needed

            if not symbol or not side or not size:
                return {'success': False, 'error': 'Missing trade data for closing position'}

            # Determine the opposite side to close the position
            close_side = 'sell' if side.lower() == 'long' else 'buy'

            # Create a market order to close the position
            params = {
                'category': 'linear', # Specify category for Bybit
                'reduceOnly': True # Ensure this order only reduces the position
            }
            # if position_idx is not None:
            #     params['positionIdx'] = position_idx

            order = self.exchange.create_order(
                symbol=symbol,
                type='market',
                side=close_side,
                amount=size,
                params=params
            )

            print(f"Close order placed on Bybit: {order}")

            return {'success': True, 'result': order}

        except Exception as e:
            print(f"Error closing position on Bybit: {str(e)}")
            return {'success': False, 'error': str(e)}

    def process_trade(self, trade):
        """Process a single trade - calculate ROI, format timestamps, etc."""
        # Calculate ROI
        if 'closedPnl' in trade and 'avgEntryPrice' in trade and 'qty' in trade:
            pnl = float(trade['closedPnl'])
            entry_price = float(trade['avgEntryPrice'])
            qty = float(trade['qty'])
            
            # Calculate investment amount
            investment = entry_price * abs(float(qty))
            
            # Calculate ROI
            if investment != 0:
                trade['roi'] = (pnl / investment) * 100
            else:
                trade['roi'] = 0
            
            # Format timestamp
            if 'updatedTime' in trade:
                timestamp_ms = int(trade['updatedTime'])
        
        # Map V5 API field names to match our frontend expectations
        trade['symbol'] = trade.get('symbol', '')
        trade['side'] = trade.get('side', '')
        trade['entry_price'] = trade.get('avgEntryPrice', '')
        trade['exit_price'] = trade.get('avgExitPrice', '')
        trade['qty'] = trade.get('qty', '')
        trade['closed_pnl'] = trade.get('closedPnl', '')
        trade['created_at'] = str(int(int(trade.get('updatedTime', '0'))/1000))  # Convert to seconds