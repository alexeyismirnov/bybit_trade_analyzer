from flask import Blueprint, jsonify, request
import os
import ccxt # Import ccxt
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
from cache_manager import CacheManager
from auth import login_required

# Load environment variables from .env file
load_dotenv()

# Bybit API credentials (loaded from environment variables)
API_KEY = os.environ.get('BYBIT_API_KEY', '')
API_SECRET = os.environ.get('BYBIT_API_SECRET', '')

# Initialize ccxt Bybit exchange object
exchange = ccxt.bybit({
    'apiKey': API_KEY,
    'secret': API_SECRET,
    'enableRateLimit': True, # Optional: enable built-in rate limiting
})
exchange.options['defaultType'] = 'swap' # Set default market type to swap for perpetuals


# Initialize cache manager
DB_URL = os.environ.get('DATABASE_URL', '')
cache_manager = CacheManager(DB_URL)

api_bp = Blueprint('api', __name__, url_prefix='/api')


@api_bp.route('/trades')
@login_required  # Add login_required decorator to protect this endpoint
def get_completed_trades():
    """Fetch completed USDT Perpetual trades from Bybit Unified Account"""
    try:
        # Get query parameters
        symbol = request.args.get('symbol', None)
        days = request.args.get('days', None)
        force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
        
        # Calculate the target date range
        end_time = int(time.time() * 1000)  # Current time in milliseconds
        start_time = end_time
        if days and days.isdigit():
            days = int(days)
            start_time = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
        
        # If force refresh is requested, fetch everything from API
        if force_refresh:
            all_trades = fetch_all_completed_trades_for_period(symbol, start_time, end_time, force_refresh=True)
            
            return jsonify({
                'success': True, 
                'trades': all_trades,
                'from_cache': False,
                'cached_at': datetime.utcnow().isoformat()
            })
        
        # Otherwise, try to use cached data when possible
        all_trades = fetch_all_completed_trades_for_period(symbol, start_time, end_time)
        
        # Get the most recent fetch time
        cached_at = cache_manager.get_most_recent_fetch_time(symbol, start_time, end_time)
        
        # Determine if data came from cache (at least partially)
        from_cache = cached_at is not None
        
        return jsonify({
            'success': True, 
            'trades': all_trades,
            'from_cache': from_cache,
            'cached_at': cached_at.isoformat() if cached_at else datetime.utcnow().isoformat()
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def fetch_completed_trades_from_api(symbol=None, start_time=None, end_time=None):
    """Fetch completed trades from Bybit API, handling pagination and chunking"""
    all_trades = []
    
    # Start from the end_time and work backwards in 7-day chunks
    current_end = end_time
    current_start = max(current_end - (7 * 24 * 60 * 60 * 1000), start_time)  # 7 days in milliseconds or start_time
    
    # We'll make up to 20 requests to cover longer time periods
    max_requests = 20
    request_count = 0
    
    while current_start >= start_time and request_count < max_requests:
        # Fetch trades for this 7-day window
        batch_trades = make_api_request(symbol, current_start, current_end)
        
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
    if all_trades and cache_manager.is_cache_available():
        cache_manager.update_cache_ranges(symbol, start_time, end_time)
    
    return all_trades

def fetch_all_completed_trades_for_period(symbol=None, start_time=None, end_time=None, force_refresh=False):
    """
    Fetch all completed trades for a period, using cache when possible and making API calls
    only for time ranges that aren't cached
    """
    all_trades = []
    
    if not force_refresh and cache_manager.is_cache_available():
        # Get cached range for this symbol
        cached_range = cache_manager.get_cached_range(symbol)
        
        if cached_range:
            # Determine which time ranges we need to fetch from API
            uncached_ranges = cache_manager.get_uncached_ranges(cached_range, start_time, end_time)
            
            # First, get all trades from cache that fall within our target period
            cached_trades = cache_manager.get_cached_trades(symbol, start_time, end_time)
            all_trades.extend(cached_trades)
            
            # Then fetch any uncached ranges from API
            for range_start, range_end in uncached_ranges:
                print(f"Fetching uncached range: {datetime.fromtimestamp(range_start/1000)} to {datetime.fromtimestamp(range_end/1000)}")
                api_trades = fetch_completed_trades_from_api(symbol, range_start, range_end)
                all_trades.extend(api_trades)
        else:
            # No cached range, fetch everything from API
            all_trades = fetch_completed_trades_from_api(symbol, start_time, end_time)
    else:
        # No cache available or force refresh requested, fetch everything from API
        all_trades = fetch_completed_trades_from_api(symbol, start_time, end_time)
    
    # Process all trades (calculate ROI, format timestamps, etc.)
    for trade in all_trades:
        process_trade(trade)
    
    # Sort all trades by timestamp (newest first for display)
    all_trades.sort(key=lambda x: int(x.get('updatedTime', 0)), reverse=True)
    
    return all_trades

def fetch_open_trades_from_api(symbol=None):
    """Fetch open positions from Bybit API using ccxt"""
    try:
        params = {'category': 'linear', 'settleCoin': 'USDT'}
        if symbol:
            # ccxt expects symbol in format: BTC/USDT:USDT
            # However, for fetching positions, Bybit V5 API via ccxt might just need the base symbol like BTCUSDT
            # Or it might infer from defaultType. Let's try with the direct symbol first.
            # If issues arise, we might need to format it as exchange.market(symbol)['id']
            params['symbol'] = symbol

        # unifiedMarginFetchPositions / fetch_positions for unified account
        # privateGetPositionList for V5
        positions = exchange.fetch_positions(symbols=[symbol] if symbol else None, params=params)
        
        open_trades = []
        for trade in positions:
            # Filter out positions with zero size (not truly open)
            if float(trade.get('contracts', 0) or trade.get('info', {}).get('size', 0)) == 0: # contracts for unified, size for v5 info
                continue

            # Adapt ccxt response to existing structure if needed
            # ccxt usually returns 'unrealizedPnl' and 'initialMargin' or 'collateral'
            # 'positionValue' might be 'initialMargin' * 'leverage' or 'contracts' * 'markPrice'
            
            unrealised_pnl = float(trade.get('unrealizedPnl', 0))
            # position_value = float(trade.get('initialMargin', 0)) * float(trade.get('leverage', 1)) # Approximation
            # More accurate: contracts * markPrice
            contracts = float(trade.get('contracts', 0) or trade.get('info', {}).get('size', 0))
            mark_price = float(trade.get('markPrice', 0) or trade.get('info', {}).get('markPrice', 0))
            position_value = contracts * mark_price

            roi = 0
            if position_value != 0:
                roi = (unrealised_pnl / position_value) * 100
            
            # Map ccxt fields to your existing structure
            # This mapping will depend on the exact fields your frontend/processing expects
            # For now, let's assume a basic mapping.
            open_trades.append({
                'symbol': trade.get('symbol'),
                'side': trade.get('side'),
                'size': contracts, # 'contracts' or 'info.size'
                'avgPrice': trade.get('entryPrice', trade.get('info', {}).get('avgPrice')), # 'entryPrice' or 'info.avgPrice'
                'markPrice': mark_price,
                'unrealisedPnl': unrealised_pnl,
                'leverage': trade.get('leverage', trade.get('info', {}).get('leverage')),
                'positionValue': position_value, # Calculated above
                'roi': roi,
                # Add other fields your frontend might need, mapping from trade['info']
                'updatedTime': trade.get('timestamp', int(time.time() * 1000)), # Or from trade['info']['updatedTime']
                'liqPrice': trade.get('liquidationPrice', trade.get('info', {}).get('liqPrice')),
                'positionIM': trade.get('initialMargin', trade.get('info', {}).get('positionIM')),
                'positionMM': trade.get('maintenanceMargin', trade.get('info', {}).get('positionMM')),
            })
            
        return open_trades
    except ccxt.NetworkError as e:
        print(f"CCXT Network Error fetching open trades: {str(e)}")
        # Consider re-raising or returning a specific error structure
        raise e
    except ccxt.ExchangeError as e:
        print(f"CCXT Exchange Error fetching open trades: {str(e)}")
        raise e
    except Exception as e:
        print(f"Generic Error fetching open trades with ccxt: {str(e)}")
        raise e

@api_bp.route('/open-trades')
@login_required  # Add login_required decorator to protect this endpoint
def get_open_trades():
    """Fetch open USDT Perpetual trades from Bybit Unified Account"""
    try:
        # Get query parameters
        symbol = request.args.get('symbol', None)
        
        open_trades = fetch_open_trades_from_api(symbol)
        
        return jsonify({
            'success': True,
            'open_trades': open_trades
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@api_bp.route('/wallet-balance')
@login_required  # Add login_required decorator to protect this endpoint
def get_wallet_balance():
    """Fetch wallet balance from Bybit Unified Account using ccxt"""
    try:
        # Parameters for fetching UNIFIED account USDT balance
        # ccxt's fetch_balance might use 'type' or specific params for account types.
        # For Bybit V5, 'accountType': 'UNIFIED' is common.
        # We also want to filter for USDT.
        params = {'accountType': 'UNIFIED'} # May need to adjust based on ccxt bybit implementation details
        
        balance_data = exchange.fetch_balance(params=params)
        
        # ccxt returns a structure where balance_data['USDT']['total'] or ['free'] or ['used'] exists.
        # We are interested in the total wallet balance for USDT.
        # The exact structure can vary slightly, by default it's often balance_data['USDT']['total']
        # For Bybit V5, the response from exchange.privateGetAccountWalletBalance
        # is usually a list of accounts, and we need to find the UNIFIED one, then the USDT coin.
        # ccxt's fetch_balance should abstract this.
        
        usdt_balance = None
        if 'USDT' in balance_data:
            usdt_balance = balance_data['USDT'].get('total') # Common ccxt structure
        elif balance_data.get('info') and isinstance(balance_data['info'].get('list'), list):
            # Fallback to checking the raw 'info' if direct USDT access fails
            # This handles cases where ccxt fetch_balance returns the raw API structure under 'info'
            for account_info in balance_data['info']['list']:
                if account_info.get('accountType') == 'UNIFIED':
                    for coin_info in account_info.get('coin', []):
                        if coin_info.get('coin') == 'USDT':
                            usdt_balance = coin_info.get('walletBalance')
                            break
                    if usdt_balance is not None:
                        break
        
        if usdt_balance is not None:
            return jsonify({
                'success': True,
                'wallet_balance': usdt_balance
            })
        else:
            # If USDT balance is still not found, check the overall structure for clues
            # This might happen if ccxt bybit wrapper for fetch_balance has a different structure for UNIFIED
            # For example, it might be nested under a specific account type key if not 'UNIFIED' directly
            # Or it might be in balance_data['total']['USDT']
            if balance_data.get('total') and 'USDT' in balance_data['total']:
                 usdt_balance = balance_data['total']['USDT']
                 return jsonify({
                    'success': True,
                    'wallet_balance': usdt_balance
                })

            print(f"USDT Wallet balance not found directly. Full balance data: {balance_data}")
            return jsonify({
                'success': False,
                'error': 'USDT wallet balance not found in the response structure from ccxt.'
            })

    except ccxt.NetworkError as e:
        print(f"CCXT Network Error fetching wallet balance: {str(e)}")
        return jsonify({'success': False, 'error': f"Network Error: {str(e)}"})
    except ccxt.ExchangeError as e:
        print(f"CCXT Exchange Error fetching wallet balance: {str(e)}")
        return jsonify({'success': False, 'error': f"Exchange Error: {str(e)}"})
    except Exception as e:
        print(f"Generic Error fetching wallet balance with ccxt: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})


def process_trade(trade):
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


def make_api_request(symbol=None, start_time=None, end_time=None):
    """Make a single API request to Bybit using ccxt to fetch closed P&L"""
    try:
        ccxt_params = {
            'category': 'linear',
            'limit': 100  # ccxt usually expects integers for limit
        }
        if symbol:
            ccxt_params['symbol'] = symbol
        if start_time:
            ccxt_params['startTime'] = int(start_time) # Ensure it's an integer timestamp
        if end_time:
            ccxt_params['endTime'] = int(end_time) # Ensure it's an integer timestamp

        # Using privateGetPositionClosedPnl to match the original endpoint
        # ccxt.bybit has methods like privateGetPositionClosedPnl
        data = exchange.privateGetV5PositionClosedPnl(ccxt_params)

        if data and data.get('retCode') == '0':
            # API call was successful according to Bybit
            result_data = data.get('result', {})
            trades_list = result_data.get('list', []) # Default to empty list if 'list' is not found

            # Ensure trades_list is actually a list, as API might unexpectedly not return a list
            if not isinstance(trades_list, list):
                print(f"Warning: 'list' in result is not a list. Actual type: {type(trades_list)}. Result: {result_data}")
                trades_list = [] # Treat as no trades if structure is incorrect

            if trades_list: # If there are trades in the list
                # Assuming cache_manager.cache_trades handles the processing via the passed function
                if cache_manager.is_cache_available():
                    cache_manager.cache_trades(trades_list, process_trade)
            # else:
                # No trades found in the list (trades_list is empty), but API call was successful.
                # This is a valid scenario, not an error.
                # print(f"No trades returned by API, but call successful. Response: {data}") # Optional: for debugging

            return trades_list # Return the list of trades (could be empty)
        else:
            # Genuine API error (retCode != 0 or data is None/falsy)
            error_code = data.get('retCode', 'Unknown') if data else 'N/A'
            error_message = data.get('retMsg', 'Unknown error') if data else 'No response from API'
            
            log_msg = f"API Error (ccxt): {error_message} (Code: {error_code})"
            print(log_msg)
            if data: # Log the full response only if data is not None
                 print(f"Full error response from ccxt: {data}")
            return []

    except ccxt.NetworkError as e:
        print(f"CCXT Network Error in make_api_request: {str(e)}")
        # Re-raise or return empty list based on how errors should propagate
        # For now, returning empty list to match original behavior on error
        return []
    except ccxt.ExchangeError as e:
        # This could be an auth error, rate limit, etc.
        print(f"CCXT Exchange Error in make_api_request: {str(e)}")
        # print(f"CCXT Exchange Error details: {e.args}") # More details
        return []
    except Exception as e:
        print(f"Generic Error in make_api_request with ccxt: {str(e)}")
        return []