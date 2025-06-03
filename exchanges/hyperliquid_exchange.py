# exchanges/hyperliquid_exchange.py
import os
import ccxt
import time
from datetime import datetime

class HyperliquidExchange:
    def __init__(self, api_key, api_secret, wallet_address, private_key, cache_manager):
        self.exchange = ccxt.hyperliquid({
            'apiKey': api_key,
            'secret': api_secret,
            'walletAddress': wallet_address,
            'privateKey': private_key,
            'enableRateLimit': True,
            'options': {
                'defaultType': 'swap',
            }
        })
        self.wallet_address = wallet_address
        self.cache_manager = cache_manager

    def make_api_request(self, symbol=None, start_time=None, end_time=None):
        """Make a single API request using ccxt to fetch trades"""
        try:
            # Adjust parameters for Hyperliquid
            ccxt_params = {
                'limit': 100
            }
            
            if self.wallet_address:
                ccxt_params['user'] = self.wallet_address
                
            if symbol:
                ccxt_params['symbol'] = symbol
            if start_time:
                ccxt_params['since'] = int(start_time)
            if end_time:
                ccxt_params['until'] = int(end_time)
            
            # Use appropriate method for Hyperliquid
            try:
                trades_list = self.exchange.fetch_my_trades(symbol, since=start_time, limit=100, params=ccxt_params)
            except Exception as e:
                print(f"Error fetching trades from Hyperliquid: {str(e)}")
                # Try alternative endpoint if available
                try:
                    trades_list = self.exchange.fetch_closed_orders(symbol, since=start_time, limit=100, params=ccxt_params)
                except Exception as e2:
                    print(f"Error fetching closed orders from Hyperliquid: {str(e2)}")
                    return []
            
            # Just return the raw trades - we'll process them later
            return trades_list
                
        except ccxt.NetworkError as e:
            print(f"CCXT Network Error in make_api_request for hyperliquid: {str(e)}")
            return []
        except ccxt.ExchangeError as e:
            print(f"CCXT Exchange Error in make_api_request for hyperliquid: {str(e)}")
            return []
        except Exception as e:
            print(f"Generic Error in make_api_request with ccxt for hyperliquid: {str(e)}")
            import traceback
            traceback.print_exc()
            return []

    def fetch_completed_trades(self, symbol=None, start_time=None, end_time=None):
        """Fetch completed trades from API, handling pagination and chunking"""
        all_raw_trades = []
        
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
            all_raw_trades.extend(batch_trades)
            
            # Move to the next 7-day window
            current_end = current_start - 1
            current_start = max(current_end - (7 * 24 * 60 * 60 * 1000), start_time)
            
            # If we've reached the start_time, we're done
            if current_end <= start_time:
                break
                
            request_count += 1
            
            # Add a small delay between requests
            time.sleep(0.1)
        
        # Now process all trades at once to match opens with closes
        formatted_trades = self._process_raw_trades(all_raw_trades)
        
        # Update cache ranges after fetching new data
        if formatted_trades and self.cache_manager.is_cache_available():
            self.cache_manager.update_cache_ranges(symbol, start_time, end_time, 'hyperliquid')
            self.cache_manager.cache_trades(formatted_trades, self.process_trade, 'hyperliquid')
        
        return formatted_trades
    
    def _process_raw_trades(self, raw_trades):
        """Process raw trades to match opens with closes"""
        
        # Group trades by symbol
        trades_by_symbol = {}
        for trade in raw_trades:
            symbol_name = trade.get('symbol', '')
            if symbol_name not in trades_by_symbol:
                trades_by_symbol[symbol_name] = []
            trades_by_symbol[symbol_name].append(trade)
        
        formatted_trades = []
        
        # Process each symbol's trades
        for symbol_name, symbol_trades in trades_by_symbol.items():
            # Clean up symbol name - remove ":USDC" suffix
            clean_symbol = symbol_name
            if ":USDC" in clean_symbol:
                clean_symbol = clean_symbol.replace(":USDC", "")
            
            # Sort trades by timestamp (oldest first)
            symbol_trades.sort(key=lambda x: x.get('timestamp', 0))
            
            # Keep track of open positions
            open_positions = {
                'long': [],  # List of open long positions
                'short': []  # List of open short positions
            }
            
            # Process each trade in chronological order
            for trade in symbol_trades:
                trade_info = trade.get('info', {})
                direction = trade_info.get('dir', '')
                size = float(trade_info.get('sz', 0))
                price = float(trade_info.get('px', 0))
                timestamp = int(trade_info.get('time', 0))
                fee = float(trade_info.get('fee', 0))
                
                print(f"Processing trade: {symbol_name} {direction} {size} @ {price}")
                
                # Handle opening positions
                if 'Open Long' in direction:
                    open_positions['long'].append({
                        'size': size,
                        'price': price,
                        'timestamp': timestamp,
                        'trade': trade,
                        'fee': fee
                    })
                    print(f"Added open long position: {size} @ {price}")
                
                elif 'Open Short' in direction:
                    open_positions['short'].append({
                        'size': size,
                        'price': price,
                        'timestamp': timestamp,
                        'trade': trade,
                        'fee': fee
                    })
                    print(f"Added open short position: {size} @ {price}")
                
                # Handle closing positions
                elif 'Close Long' in direction:
                    if open_positions['long']:
                        # Get the oldest open position (FIFO)
                        open_position = open_positions['long'][0]
                        
                        # Calculate total fees (entry + exit)
                        total_fee = fee + open_position.get('fee', 0)
                        
                        # Calculate PnL based on entry and exit prices
                        # For long positions: (exit_price - entry_price) * size
                        calculated_pnl = (price - open_position['price']) * size
                        
                        # Adjust PNL by subtracting fees
                        adjusted_pnl = calculated_pnl - total_fee
                        
                        # Create a completed trade - for long positions, we need to use 'Sell' 
                        # to match Bybit's convention where closing a long position is a sell action
                        completed_trade = {
                            'symbol': clean_symbol,  # Use cleaned symbol name
                            'side': 'Sell',  # This will make it show as green in the UI (matching Bybit's convention)
                            'position_type': 'long',  # Add this field for clarity on the actual position type
                            'avgEntryPrice': open_position['price'],
                            'avgExitPrice': price,
                            'qty': size,
                            'closedPnl': str(adjusted_pnl),  # Use calculated and fee-adjusted PNL
                            'fee': str(total_fee),  # Include total fees
                            'updatedTime': str(timestamp),
                            'entryTime': str(open_position['timestamp']),
                            'duration': timestamp - open_position['timestamp'],
                            'raw_data': {
                                'open': open_position['trade'],
                                'close': trade
                            }
                        }
                        
                        formatted_trades.append(completed_trade)
                        print(f"Created completed trade: Entry @ {open_position['price']}, Exit @ {price}, PNL: {adjusted_pnl} (after fees: {total_fee})")
                        
                        # Handle partial closes
                        if size >= open_position['size']:
                            # Position fully closed
                            remaining = size - open_position['size']
                            open_positions['long'].pop(0)
                            
                            # If there's remaining size to close, continue with next open position
                            while remaining > 0 and open_positions['long']:
                                next_position = open_positions['long'][0]
                                if remaining >= next_position['size']:
                                    # Close this position completely too
                                    open_positions['long'].pop(0)
                                    remaining -= next_position['size']
                                else:
                                    # Partially close this position
                                    next_position['size'] -= remaining
                                    remaining = 0
                        else:
                            # Position partially closed
                            open_position['size'] -= size
                    else:
                        print(f"Warning: Could not find matching open trade for close trade: {direction}")
                
                elif 'Close Short' in direction:
                    if open_positions['short']:
                        # Get the oldest open position (FIFO)
                        open_position = open_positions['short'][0]
                        
                        # Calculate total fees (entry + exit)
                        total_fee = fee + open_position.get('fee', 0)
                        
                        # Calculate PnL based on entry and exit prices
                        # For short positions: (entry_price - exit_price) * size
                        calculated_pnl = (open_position['price'] - price) * size
                        
                        # Adjust PNL by subtracting fees
                        adjusted_pnl = calculated_pnl - total_fee
                        
                        # Create a completed trade - for short positions, we need to use 'Buy' 
                        # to match Bybit's convention where closing a short position is a buy action
                        completed_trade = {
                            'symbol': clean_symbol,  # Use cleaned symbol name
                            'side': 'Buy',  # This will make it show as red in the UI (matching Bybit's convention)
                            'position_type': 'short',  # Add this field for clarity on the actual position type
                            'avgEntryPrice': open_position['price'],
                            'avgExitPrice': price,
                            'qty': size,
                            'closedPnl': str(adjusted_pnl),  # Use calculated and fee-adjusted PNL
                            'fee': str(total_fee),  # Include total fees
                            'updatedTime': str(timestamp),
                            'entryTime': str(open_position['timestamp']),
                            'duration': timestamp - open_position['timestamp'],
                            'raw_data': {
                                'open': open_position['trade'],
                                'close': trade
                            }
                        }
                        
                        formatted_trades.append(completed_trade)
                        print(f"Created completed trade: Entry @ {open_position['price']}, Exit @ {price}, PNL: {adjusted_pnl} (after fees: {total_fee})")
                        
                        # Handle partial closes
                        if size >= open_position['size']:
                            # Position fully closed
                            remaining = size - open_position['size']
                            open_positions['short'].pop(0)
                            
                            # If there's remaining size to close, continue with next open position
                            while remaining > 0 and open_positions['short']:
                                next_position = open_positions['short'][0]
                                if remaining >= next_position['size']:
                                    # Close this position completely too
                                    open_positions['short'].pop(0)
                                    remaining -= next_position['size']
                                else:
                                    # Partially close this position
                                    next_position['size'] -= remaining
                                    remaining = 0
                        else:
                            # Position partially closed
                            open_position['size'] -= size
                    else:
                        print(f"Warning: Could not find matching open trade for close trade: {direction}")
                
                # Handle "Short > Long" - Close a short position and open a long position
                elif 'Short > Long' in direction:
                    # First, calculate how much of the short position to close
                    closed_short_size = 0
                    remaining_size = size  # This is the total size from the trade info
                    
                    # Close existing short positions up to the total size
                    while remaining_size > 0 and open_positions['short']:
                        open_position = open_positions['short'][0]
                        
                        # Determine how much of this position to close
                        close_size = min(open_position['size'], remaining_size)
                        closed_short_size += close_size
                        
                        # Calculate total fees (entry + exit)
                        # Proportionally allocate the fee based on the closed size
                        position_fee_ratio = close_size / open_position['size']
                        position_fee = open_position.get('fee', 0) * position_fee_ratio
                        close_fee = fee * (close_size / size)  # Proportional fee for this close
                        total_fee = close_fee + position_fee
                        
                        # Calculate PnL based on entry and exit prices
                        # For short positions: (entry_price - exit_price) * size
                        calculated_pnl = (open_position['price'] - price) * close_size
                        
                        # Adjust PNL by subtracting fees
                        adjusted_pnl = calculated_pnl - total_fee
                        
                        # Create a completed trade for the closed short position
                        completed_trade = {
                            'symbol': clean_symbol,
                            'side': 'Buy',  # Closing a short position is a buy action
                            'position_type': 'short',
                            'avgEntryPrice': open_position['price'],
                            'avgExitPrice': price,
                            'qty': close_size,
                            'closedPnl': str(adjusted_pnl),
                            'fee': str(total_fee),
                            'updatedTime': str(timestamp),
                            'entryTime': str(open_position['timestamp']),
                            'duration': timestamp - open_position['timestamp'],
                            'raw_data': {
                                'open': open_position['trade'],
                                'close': trade
                            }
                        }
                        
                        formatted_trades.append(completed_trade)
                        print(f"Created completed short trade (from Short > Long): Entry @ {open_position['price']}, Exit @ {price}, PNL: {adjusted_pnl}")
                        
                        # Update position or remove it if fully closed
                        if close_size >= open_position['size']:
                            # Position fully closed
                            remaining_size -= open_position['size']
                            open_positions['short'].pop(0)
                        else:
                            # Position partially closed
                            open_position['size'] -= close_size
                            remaining_size = 0
                    
                    # Now open a new long position with the remaining size after closing shorts
                    new_long_size = size - closed_short_size
                    if new_long_size > 0:
                        open_positions['long'].append({
                            'size': new_long_size,
                            'price': price,
                            'timestamp': timestamp,
                            'trade': trade,
                            'fee': fee * (new_long_size / size)  # Proportional fee for the new position
                        })
                        print(f"Added open long position (from Short > Long): {new_long_size} @ {price}")
                
                # Handle "Long > Short" - Close a long position and open a short position
                elif 'Long > Short' in direction:
                    # First, calculate how much of the long position to close
                    closed_long_size = 0
                    remaining_size = size  # This is the total size from the trade info
                    
                    # Close existing long positions up to the total size
                    while remaining_size > 0 and open_positions['long']:
                        open_position = open_positions['long'][0]
                        
                        # Determine how much of this position to close
                        close_size = min(open_position['size'], remaining_size)
                        closed_long_size += close_size
                        
                        # Calculate total fees (entry + exit)
                        # Proportionally allocate the fee based on the closed size
                        position_fee_ratio = close_size / open_position['size']
                        position_fee = open_position.get('fee', 0) * position_fee_ratio
                        close_fee = fee * (close_size / size)  # Proportional fee for this close
                        total_fee = close_fee + position_fee
                        
                        # Calculate PnL based on entry and exit prices
                        # For long positions: (exit_price - entry_price) * size
                        calculated_pnl = (price - open_position['price']) * close_size
                        
                        # Adjust PNL by subtracting fees
                        adjusted_pnl = calculated_pnl - total_fee
                        
                        # Create a completed trade for the closed long position
                        completed_trade = {
                            'symbol': clean_symbol,
                            'side': 'Sell',  # Closing a long position is a sell action
                            'position_type': 'long',
                            'avgEntryPrice': open_position['price'],
                            'avgExitPrice': price,
                            'qty': close_size,
                            'closedPnl': str(adjusted_pnl),
                            'fee': str(total_fee),
                            'updatedTime': str(timestamp),
                            'entryTime': str(open_position['timestamp']),
                            'duration': timestamp - open_position['timestamp'],
                            'raw_data': {
                                'open': open_position['trade'],
                                'close': trade
                            }
                        }
                        
                        formatted_trades.append(completed_trade)
                        print(f"Created completed long trade (from Long > Short): Entry @ {open_position['price']}, Exit @ {price}, PNL: {adjusted_pnl}")
                        
                        # Update position or remove it if fully closed
                        if close_size >= open_position['size']:
                            # Position fully closed
                            remaining_size -= open_position['size']
                            open_positions['long'].pop(0)
                        else:
                            # Position partially closed
                            open_position['size'] -= close_size
                            remaining_size = 0
                    
                    # Now open a new short position with the remaining size after closing longs
                    new_short_size = size - closed_long_size
                    if new_short_size > 0:
                        open_positions['short'].append({
                            'size': new_short_size,
                            'price': price,
                            'timestamp': timestamp,
                            'trade': trade,
                            'fee': fee * (new_short_size / size)  # Proportional fee for the new position
                        })
                        print(f"Added open short position (from Long > Short): {new_short_size} @ {price}")
        
        return formatted_trades

    def fetch_open_trades(self, symbol=None):
        """Fetch open positions from API using ccxt"""
        try:
            # For Hyperliquid, we need to provide the user parameter
            # This should be the wallet address associated with the API key
            params = {}
            
            if self.wallet_address:
                params['user'] = self.wallet_address
            
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

                # Try to get notional from 'notional' key first, if markPrice is not available or zero
                position_value = float(trade.get('notional', 0))
                if position_value == 0 and mark_price != 0:
                    position_value = contracts * mark_price
                elif position_value == 0 and mark_price == 0:
                    # Fallback to calculating if 'notional' is also not available or zero
                    position_value = contracts * mark_price

                roi = 0
                if position_value != 0:
                    roi = (unrealised_pnl / position_value) * 100
                
                # Determine side based on 'szi' if top-level 'side' is None
                trade_side = trade.get('side')
                if trade_side is None and trade.get('info', {}).get('position', {}).get('szi') is not None:
                    try:
                        szi = float(trade['info']['position']['szi'])
                        trade_side = 'long' if szi > 0 else 'short'
                    except (ValueError, TypeError):
                        print(f"Could not parse szi to determine side for trade: {trade}")
                        trade_side = None # Keep side as None if parsing fails
                        
                open_trades.append({
                    'symbol': trade.get('symbol'),
                    'side': trade_side,
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
                    'exchange': 'hyperliquid'
                })
                
            return open_trades
        except ccxt.NetworkError as e:
            print(f"CCXT Network Error fetching open trades from hyperliquid: {str(e)}")
            raise e
        except ccxt.ExchangeError as e:
            print(f"CCXT Exchange Error fetching open trades from hyperliquid: {str(e)}")
            raise e
        except Exception as e:
            print(f"Generic Error fetching open trades with ccxt from hyperliquid: {str(e)}")
            raise e

    def fetch_wallet_balance(self):
        """Fetch wallet balance from Hyperliquid"""
        try:
            params = {}
            
            if self.wallet_address:
                params['user'] = self.wallet_address
            
            balance_data = self.exchange.fetch_balance(params=params)
            
            # Extract balance
            balance_value = None
            
            # For Hyperliquid, check USDC first (based on the actual response)
            if 'USDC' in balance_data:
                balance_value = balance_data['USDC'].get('total')
            elif 'USDT' in balance_data:
                balance_value = balance_data['USDT'].get('total')
            elif 'USD' in balance_data:
                balance_value = balance_data['USD'].get('total')
            elif balance_data.get('total'):
                if 'USDC' in balance_data['total']:
                    balance_value = balance_data['total']['USDC']
                elif 'USDT' in balance_data['total']:
                    balance_value = balance_data['total']['USDT']
                elif 'USD' in balance_data['total']:
                    balance_value = balance_data['total']['USD']
            
            # If still not found, try to extract from the raw info
            if balance_value is None and balance_data.get('info'):
                info = balance_data['info']
                if isinstance(info, dict):
                    # Try to find balance in various fields based on the response structure
                    if 'marginSummary' in info and 'accountValue' in info['marginSummary']:
                        balance_value = info['marginSummary']['accountValue']
                    elif 'withdrawable' in info:
                        balance_value = info['withdrawable']
                    elif 'free' in info:
                        balance_value = info['free']
                    elif 'balance' in info:
                        balance_value = info['balance']
            
            # Convert to float
            if balance_value is not None:
                try:
                    balance_value = float(balance_value)
                except (ValueError, TypeError):
                    print(f"Could not convert balance value to float: {balance_value}")
                    balance_value = 0
            
            return balance_value
        except Exception as e:
            print(f"Error fetching wallet balance from Hyperliquid: {str(e)}")
            raise e

    def process_trade(self, trade):
        """Process a single trade - calculate ROI, format timestamps, etc."""
        try:
            # Extract PNL value
            pnl = 0
            if 'closedPnl' in trade:
                pnl = float(trade['closedPnl'])
            
            # Extract entry price
            entry_price = 0
            if 'avgEntryPrice' in trade:
                entry_price = float(trade['avgEntryPrice'])
            
            # Extract exit price
            exit_price = 0
            if 'avgExitPrice' in trade:
                exit_price = float(trade['avgExitPrice'])
            
            # Extract quantity
            qty = 0
            if 'qty' in trade:
                qty = float(trade['qty'])
            
            # Calculate investment amount
            investment = entry_price * abs(qty)
            
            # Calculate ROI
            if investment != 0:
                trade['roi'] = (pnl / investment) * 100
            else:
                trade['roi'] = 0
            
            # Calculate price difference percentage
            if entry_price != 0:
                price_diff_pct = ((exit_price - entry_price) / entry_price) * 100
                # For short positions, invert the sign
                if trade.get('side', '') == 'Sell':  # Match the capitalized 'Sell'
                    price_diff_pct = -price_diff_pct
                trade['price_change_pct'] = price_diff_pct
            else:
                trade['price_change_pct'] = 0
            
            # Format duration if available
            if 'duration' in trade:
                duration_ms = trade['duration']
                # Convert to hours, minutes, seconds
                seconds = duration_ms / 1000
                hours = int(seconds // 3600)
                minutes = int((seconds % 3600) // 60)
                seconds = int(seconds % 60)
                trade['duration_formatted'] = f"{hours}h {minutes}m {seconds}s"
        except (ValueError, TypeError) as e:
            print(f"Error processing trade: {e}")
            print(f"Trade data: {trade}")
            # Set default values if calculation fails
            trade['roi'] = 0
            trade['price_change_pct'] = 0
        
        # Map field names to match our frontend expectations
        trade['symbol'] = trade.get('symbol', '')
        trade['side'] = trade.get('side', '')  # Keep the capitalized side value
        trade['entry_price'] = trade.get('avgEntryPrice', '')
        trade['exit_price'] = trade.get('avgExitPrice', '')
        trade['qty'] = trade.get('qty', '')
        trade['closed_pnl'] = trade.get('closedPnl', '')
        
        # Set timestamps
        if 'entryTime' in trade:
            trade['entry_time'] = str(int(int(trade.get('entryTime', '0'))/1000))  # Convert to seconds
        
        if 'updatedTime' in trade:
            trade['exit_time'] = str(int(int(trade.get('updatedTime', '0'))/1000))  # Convert to seconds
            trade['created_at'] = trade['exit_time']  # For compatibility with existing code