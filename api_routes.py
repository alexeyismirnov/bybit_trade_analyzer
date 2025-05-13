from flask import Blueprint, jsonify, request
import os
import requests
import time
import hmac
import hashlib
from datetime import datetime, timedelta
from dotenv import load_dotenv
from cache_manager import CacheManager
from auth import login_required 

# Load environment variables from .env file
load_dotenv()

# Bybit API credentials (loaded from environment variables)
API_KEY = os.environ.get('BYBIT_API_KEY', '')
API_SECRET = os.environ.get('BYBIT_API_SECRET', '')

# Initialize cache manager
DB_URL = os.environ.get('DATABASE_URL', '')
cache_manager = CacheManager(DB_URL)

api_bp = Blueprint('api', __name__, url_prefix='/api')

def get_signature(timestamp, recv_window, query_string):
    """
    Generate signature for Bybit V5 API authentication
    This follows exactly Bybit's documentation for signature generation
    """
    # Create signature payload: timestamp + api_key + recv_window + query_string
    payload = f"{timestamp}{API_KEY}{recv_window}{query_string}"
    
    # Generate HMAC SHA256 signature
    signature = hmac.new(
        bytes(API_SECRET, 'utf-8'),
        msg=bytes(payload, 'utf-8'),
        digestmod=hashlib.sha256
    ).hexdigest()
    
    return signature

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
    """Fetch open positions from Bybit API"""
    # Generate fresh timestamp for API request
    timestamp = str(int(time.time() * 1000))
    recv_window = "5000"
    
    # Base parameters
    params = {
        'category': 'linear',
        'settleCoin': 'USDT' # Add settleCoin for USDT Perpetual trades
    }
    
    # Add optional parameters
    if symbol:
        params['symbol'] = symbol
    
    # Sort parameters alphabetically and create query string
    sorted_params = sorted(params.items())
    query_string = '&'.join([f"{key}={value}" for key, value in sorted_params])
    
    # Generate signature
    signature = get_signature(timestamp, recv_window, query_string)
    
    # V5 API endpoint for open positions in Unified account
    url = "https://api.bybit.com/v5/position/list"
    
    headers = {
        'X-BAPI-SIGN': signature,
        'X-BAPI-API-KEY': API_KEY,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recv_window
    }
    
    # Make the request
    response = requests.get(f"{url}?{query_string}", headers=headers)
    data = response.json()
    
    # Add print statement to inspect the API response
    if data['retCode'] == 0 and 'list' in data['result']:
        open_trades = data['result']['list']
        
        # Calculate ROI for each open trade
        for trade in open_trades:
            try:
                unrealised_pnl = float(trade.get('unrealisedPnl', 0))
                position_value = float(trade.get('positionValue', 0))
                
                if position_value != 0:
                    trade['roi'] = (unrealised_pnl / position_value) * 100
                else:
                    trade['roi'] = 0
            except (ValueError, TypeError):
                trade['roi'] = 0 # Handle cases where conversion to float fails
                
        return open_trades
    else:
        error_msg = f"API Error fetching open trades: {data.get('retMsg', 'Unknown error')} (Code: {data.get('retCode', 'Unknown')})"
        print(error_msg)  # Log the error
        return []

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
    """Fetch wallet balance from Bybit Unified Account"""
    try:
        # Generate fresh timestamp for API request
        timestamp = str(int(time.time() * 1000))
        recv_window = "5000"

        # Base parameters
        params = {
            'accountType': 'UNIFIED',
            'coin': 'USDT'
        }

        # Sort parameters alphabetically and create query string
        sorted_params = sorted(params.items())
        query_string = '&'.join([f"{key}={value}" for key, value in sorted_params])

        # Generate signature
        signature = get_signature(timestamp, recv_window, query_string)

        # V5 API endpoint for wallet balance in Unified account
        url = "https://api.bybit.com/v5/account/wallet-balance"

        headers = {
            'X-BAPI-SIGN': signature,
            'X-BAPI-API-KEY': API_KEY,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': recv_window
        }

        # Make the request
        response = requests.get(f"{url}?{query_string}", headers=headers)
        data = response.json()

        if data['retCode'] == 0 and 'list' in data['result']:
            # Extract total wallet balance for USDT from the nested 'coin' list
            wallet_balance = None
            if data['result']['list']:
                # Assuming the first item in the list contains the coin information
                coin_list = data['result']['list'][0].get('coin', [])
                for coin_info in coin_list:
                    if coin_info.get('coin') == 'USDT':
                        wallet_balance = coin_info.get('walletBalance')
                        break
    
            if wallet_balance is not None:
                 return jsonify({
                    'success': True,
                    'wallet_balance': wallet_balance
                })
            else:
                 return jsonify({
                    'success': False,
                    'error': 'USDT wallet balance not found in the response'
                })
        else:
            error_msg = f"API Error fetching wallet balance: {data.get('retMsg', 'Unknown error')} (Code: {data.get('retCode', 'Unknown')})"
            print(error_msg)  # Log the error
            return jsonify({'success': False, 'error': error_msg})

    except Exception as e:
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
    """Make a single API request to Bybit"""
    # Generate fresh timestamp for API request
    timestamp = str(int(time.time() * 1000))
    recv_window = "5000"
    
    # Base parameters
    params = {
        'category': 'linear',
        'limit': '100'
    }
    
    # Add optional parameters
    if symbol:
        params['symbol'] = symbol
    if start_time:
        params['startTime'] = str(start_time)
    if end_time:
        params['endTime'] = str(end_time)
    
    # Sort parameters alphabetically and create query string
    sorted_params = sorted(params.items())
    query_string = '&'.join([f"{key}={value}" for key, value in sorted_params])
    
    # Generate signature
    signature = get_signature(timestamp, recv_window, query_string)
    
    # V5 API endpoint for closed positions in Unified account
    url = "https://api.bybit.com/v5/position/closed-pnl"
    
    headers = {
        'X-BAPI-SIGN': signature,
        'X-BAPI-API-KEY': API_KEY,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recv_window
    }
    
    # Make the request
    response = requests.get(f"{url}?{query_string}", headers=headers)
    data = response.json()
    
    if data['retCode'] == 0 and 'list' in data['result']:
        trades = data['result']['list']
        # Cache the trades in the database
        if cache_manager.is_cache_available():
            cache_manager.cache_trades(trades, process_trade)
        return trades
    else:
        error_msg = f"API Error: {data.get('retMsg', 'Unknown error')} (Code: {data.get('retCode', 'Unknown')})"
        print(error_msg)  # Log the error
        return []