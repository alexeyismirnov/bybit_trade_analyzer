# api_routes.py
from flask import Blueprint, jsonify, request
import os
import time
from datetime import datetime, timedelta
from dotenv import load_dotenv
from cache_manager import CacheManager
from auth import login_required
from exchanges.bybit_exchange import BybitExchange
from exchanges.hyperliquid_exchange import HyperliquidExchange

# Load environment variables from .env file
load_dotenv()

# Bybit API credentials (loaded from environment variables)
BYBIT_API_KEY = os.environ.get('BYBIT_API_KEY', '')
BYBIT_API_SECRET = os.environ.get('BYBIT_API_SECRET', '')

# Hyperliquid API credentials (loaded from environment variables)
HYPERLIQUID_API_KEY = os.environ.get('HYPERLIQUID_API_KEY', '')
HYPERLIQUID_API_SECRET = os.environ.get('HYPERLIQUID_API_SECRET', '')
HYPERLIQUID_WALLET_ADDRESS = os.environ.get('HYPERLIQUID_WALLET_ADDRESS', '')
HYPERLIQUID_PRIVATE_KEY = os.environ.get('HYPERLIQUID_PRIVATE_KEY', '')

# Initialize cache manager
DB_URL = os.environ.get('DATABASE_URL', '')
cache_manager = CacheManager(DB_URL)

# Initialize exchange objects
exchanges = {
    'bybit': BybitExchange(BYBIT_API_KEY, BYBIT_API_SECRET, cache_manager),
    'hyperliquid': HyperliquidExchange(HYPERLIQUID_API_KEY, HYPERLIQUID_API_SECRET, HYPERLIQUID_WALLET_ADDRESS, HYPERLIQUID_PRIVATE_KEY, cache_manager)
}

api_bp = Blueprint('api', __name__, url_prefix='/api')


@api_bp.route('/trades')
@login_required  # Add login_required decorator to protect this endpoint
def get_completed_trades():
    """Fetch completed trades from selected exchange"""
    try:
        # Get query parameters
        symbol = request.args.get('symbol', None)
        days = request.args.get('days', None)
        force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
        exchange_name = request.args.get('exchange', 'bybit')  # Default to bybit if not specified
        
        # Calculate the target date range
        end_time = int(time.time() * 1000)  # Current time in milliseconds
        start_time = end_time
        if days and days.isdigit():
            days = int(days)
            start_time = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
        
        # If force refresh is requested, fetch everything from API
        if force_refresh:
            all_trades = fetch_all_completed_trades_for_period(exchange_name, symbol, start_time, end_time, force_refresh=True)
            
            return jsonify({
                'success': True, 
                'trades': all_trades,
                'from_cache': False,
                'cached_at': datetime.utcnow().isoformat(),
                'exchange': exchange_name
            })
        
        # Otherwise, try to use cached data when possible
        all_trades = fetch_all_completed_trades_for_period(exchange_name, symbol, start_time, end_time)
        
        # Get the most recent fetch time
        cached_at = cache_manager.get_most_recent_fetch_time(symbol, start_time, end_time, exchange_name)
        
        # Determine if data came from cache (at least partially)
        from_cache = cached_at is not None
        
        return jsonify({
            'success': True, 
            'trades': all_trades,
            'from_cache': from_cache,
            'cached_at': cached_at.isoformat() if cached_at else datetime.utcnow().isoformat(),
            'exchange': exchange_name
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


def fetch_all_completed_trades_for_period(exchange_name, symbol=None, start_time=None, end_time=None, force_refresh=False):
    """
    Fetch all completed trades for a period, using cache when possible and making API calls
    only for time ranges that aren't cached
    """
    all_trades = []
    
    # Get the appropriate exchange object
    if exchange_name not in exchanges:
        raise ValueError(f"Exchange {exchange_name} not supported")
    
    exchange = exchanges[exchange_name]
    
    if not force_refresh and cache_manager.is_cache_available():
        # Get cached range for this symbol and exchange
        cached_range = cache_manager.get_cached_range(symbol, exchange_name)
        
        if cached_range:
            # Determine which time ranges we need to fetch from API
            uncached_ranges = cache_manager.get_uncached_ranges(cached_range, start_time, end_time)
            
            # First, get all trades from cache that fall within our target period
            cached_trades = cache_manager.get_cached_trades(symbol, start_time, end_time, exchange_name)
            all_trades.extend(cached_trades)
            
            # Then fetch any uncached ranges from API
            for range_start, range_end in uncached_ranges:
                print(f"Fetching uncached range for {exchange_name}: {datetime.fromtimestamp(range_start/1000)} to {datetime.fromtimestamp(range_end/1000)}")
                api_trades = exchange.fetch_completed_trades(symbol, range_start, range_end)
                all_trades.extend(api_trades)
        else:
            # No cached range, fetch everything from API
            all_trades = exchange.fetch_completed_trades(symbol, start_time, end_time)
    else:
        # No cache available or force refresh requested, fetch everything from API
        all_trades = exchange.fetch_completed_trades(symbol, start_time, end_time)
    
    # Process all trades (calculate ROI, format timestamps, etc.)
    for trade in all_trades:
        exchange.process_trade(trade)
    
    # Sort all trades by timestamp (newest first for display)
    all_trades.sort(key=lambda x: int(x.get('updatedTime', 0)), reverse=True)
    
    return all_trades


@api_bp.route('/open-trades')
@login_required  # Add login_required decorator to protect this endpoint
def get_open_trades():
    """Fetch open trades from selected exchange"""
    try:
        # Get query parameters
        symbol = request.args.get('symbol', None)
        exchange_name = request.args.get('exchange', 'bybit')  # Default to bybit if not specified
        
        # Get the appropriate exchange object
        if exchange_name not in exchanges:
            raise ValueError(f"Exchange {exchange_name} not supported")
        
        exchange = exchanges[exchange_name]
        
        open_trades = exchange.fetch_open_trades(symbol)
        
        return jsonify({
            'success': True,
            'open_trades': open_trades,
            'exchange': exchange_name
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@api_bp.route('/close-trade', methods=['POST'])
@login_required  # Add login_required decorator to protect this endpoint
def close_trade():
    """Close an open trade on the selected exchange"""
    try:
        data = request.get_json()
        exchange_name = data.get('exchange')
        trade_data = data.get('trade_data')

        if not exchange_name or not trade_data:
            print("Missing exchange or trade data")
            return jsonify({'success': False, 'error': 'Missing exchange or trade data'}), 400

        # Get the appropriate exchange object
        if exchange_name not in exchanges:
            print(f"Exchange {exchange_name} not supported")
            return jsonify({'success': False, 'error': f"Exchange {exchange_name} not supported"}), 400

        exchange = exchanges[exchange_name]
        result = exchange.close_position(trade_data)

        if result and result.get('success', False):
            print("Trade closed successfully")
            return jsonify({'success': True, 'message': 'Trade closed successfully', 'result': result.get('result')})
        else:
            error_message = result.get('error', 'Failed to close trade') if result else 'Failed to close trade'
            print(f"Failed to close trade: {error_message}")
            return jsonify({'success': False, 'error': error_message}), 500

    except Exception as e:
        print(f"An exception occurred while closing trade: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@api_bp.route('/wallet-balance')
@login_required  # Add login_required decorator to protect this endpoint
def get_wallet_balance():
    """Fetch wallet balance from selected exchange"""
    try:
        exchange_name = request.args.get('exchange', 'bybit')  # Default to bybit if not specified
        
        # Get the appropriate exchange object
        if exchange_name not in exchanges:
            raise ValueError(f"Exchange {exchange_name} not supported")
        
        exchange = exchanges[exchange_name]
        
        balance_value = exchange.fetch_wallet_balance()
        
        if balance_value is not None:
            return jsonify({
                'success': True,
                'wallet_balance': balance_value,
                'exchange': exchange_name
            })
        else:
            print(f"Wallet balance not found for {exchange_name}.")
            return jsonify({
                'success': False,
                'error': f'Wallet balance not found in the response structure from {exchange_name}.'
            })

    except Exception as e:
        print(f"Error fetching wallet balance from {exchange_name}: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})