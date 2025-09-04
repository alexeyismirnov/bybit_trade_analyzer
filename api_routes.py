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

# Webhook PIN (loaded from environment variables)
WEBHOOK_PIN = os.environ.get('WEBHOOK_PIN', '')

@api_bp.route('/webhook', methods=['POST'])
def webhook_handler():
    """Handle incoming Tradingview webhooks"""
    try:
        data = request.get_json()

        # Authenticate with PIN
        pin = data.get('PIN')
        if not pin or pin != WEBHOOK_PIN:
            return jsonify({'success': False, 'error': 'Invalid PIN'})

        # Extract order parameters
        exchange_name = data.get('EXCHANGE', '').lower()
        symbol = data.get('SYMBOL')
        side = data.get('SIDE')
        # price = data.get('PRICE') # Not needed for market order
        quantity = data.get('QUANTITY')
        tp_price = data.get('TP') 
        sl_price = data.get('SL')
        sl_streak = int(data.get('SL streak', 0))
        
        # Default threshold for applying the multiplier
        sl_streak_threshold = 2
        
        if not exchange_name or not symbol or not side or not quantity:
            return jsonify({'success': False, 'error': 'Missing order parameters'}), 400

        # Get the appropriate exchange object
        if exchange_name not in exchanges:
            return jsonify({'success': False, 'error': f"Exchange {exchange_name} not supported"}), 400

        exchange = exchanges[exchange_name]

        # Convert symbol format if necessary (e.g., for Bybit and Hyperliquid)
        if exchange_name == 'bybit' and symbol and symbol.endswith('.P'):
            symbol = symbol.replace('USDT.P', '/USDT:USDT')
            print(f"Converted Bybit symbol to: {symbol}")
        elif exchange_name == 'hyperliquid' and symbol and symbol.endswith('.P'):
            symbol = symbol.replace('USDT.P', '/USDC:USDC')
            print(f"Converted Hyperliquid symbol to: {symbol}")

        # Apply quantity multiplier based on SL streak if it exceeds the threshold
        original_quantity = float(quantity)
        if sl_streak > sl_streak_threshold:
            # Calculate multiplier: 2^(sl_streak - sl_streak_threshold)
            multiplier = 2 ** (sl_streak - sl_streak_threshold)
            quantity = original_quantity * multiplier
            print(f"Applied SL streak multiplier: {multiplier}x (SL streak: {sl_streak})")
            print(f"Original quantity: {original_quantity}, New quantity: {quantity}")

        order_params = {}

        if exchange_name == 'bybit':
            order_params = {
                'category': 'linear' # Assuming linear for perpetuals on Bybit
            }

        price_with_slippage = 0.0
    
        # Include price for Hyperliquid market orders for slippage calculation
        if exchange_name == 'hyperliquid':
             price = data.get('PRICE')
             if price is not None:
                 # Calculate price with slippage for Hyperliquid
                 slippage_percent = 1 # Default slippage
                 price = float(price)
                 side_lower = side.lower()

                 slippage_multiplier = (100 - slippage_percent) / 100 if side_lower == 'sell' else (100 + slippage_percent) / 100
                 price_with_slippage = price * slippage_multiplier

             else:
                 # Handle case where price is missing for Hyperliquid
                 return jsonify({'success': False, 'error': 'Price is required for Hyperliquid market orders'}), 400

        # Place the main market order
        if exchange_name == 'hyperliquid':
            order = exchange.exchange.create_order(
                symbol=symbol,
                type='market',
                side=side.lower(), # Ensure side is lowercase ('buy' or 'sell')
                amount=float(quantity),
                price=price_with_slippage,
                params=order_params
            )
        else:
            order = exchange.exchange.create_order(
                symbol=symbol,
                type='market',
                side=side.lower(), # Ensure side is lowercase ('buy' or 'sell')
                amount=float(quantity),
                params=order_params
            )
            
        print(f"Market order placed: {order}")
                
        # Place Take Profit order if TP price is provided
        if tp_price is not None and tp_price != "":
            try:
                # For TP, we need the opposite side of the entry order
                tp_side = 'sell' if side.lower() == 'buy' else 'buy'
                
                tp_params = order_params.copy()
                tp_params['reduceOnly'] = True  # Ensure this is a reduce-only order
                
                tp_order = exchange.exchange.create_order(
                    symbol=symbol,
                    type='limit',
                    side=tp_side,
                    amount=float(quantity),
                    price=float(tp_price),
                    params=tp_params
                )
                
                print(f"Take Profit order placed: {tp_order}")
            except Exception as e:
                print(f"Error placing Take Profit order: {str(e)}")
                # Continue execution even if TP order fails
        
        # Place Stop Loss order if SL price is provided
        if sl_price is not None and sl_price != "":
            try:
                # For SL, we need the opposite side of the entry order
                sl_side = 'sell' if side.lower() == 'buy' else 'buy'
                
                sl_params = order_params.copy()
                sl_params['reduceOnly'] = True  # Ensure this is a reduce-only order
                sl_params['stopPrice'] = float(sl_price)  # Set the trigger price
                
                sl_order = exchange.exchange.create_order(
                    symbol=symbol,
                    type='stop',  # Using stop order type for stop loss
                    side=sl_side,
                    amount=float(quantity),
                    price=float(sl_price),
                    params=sl_params
                )
                
                print(f"Stop Loss order placed: {sl_order}")
            except Exception as e:
                print(f"Error placing Stop Loss order: {str(e)}")
                # Continue execution even if SL order fails

        # Include SL streak info in the response
        response_data = {
            'success': True, 
            'message': 'Orders placed successfully',
        }
            
        return jsonify(response_data)

    except Exception as e:
        print(f"Error processing webhook: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)})

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


def close_position_unified(exchange_name, trade_data):
    """Close an open position on the specified exchange"""
    try:
        symbol = trade_data.get('symbol')
        side = trade_data.get('side')
        size = trade_data.get('size')
        price = trade_data.get('markPrice') or trade_data.get('avgPrice') # Use markPrice or avgPrice for slippage calculation

        if not symbol or not size:
            return {'success': False, 'error': 'Missing trade data for closing position'}

        # Get the appropriate exchange object
        if exchange_name not in exchanges:
            return {'success': False, 'error': f"Exchange {exchange_name} not supported"}

        exchange = exchanges[exchange_name]

        # Determine the opposite side to close the position
        # If side is not provided, try to determine from size (Hyperliquid specific)
        if side is None and exchange_name == 'hyperliquid':
             if size is not None:
                 try:
                     size_float = float(size)
                     side = 'long' if size_float > 0 else 'short'
                     print(f"Determined side from size for Hyperliquid: {side}")
                 except (ValueError, TypeError):
                     print(f"Could not parse size to determine side for Hyperliquid: {size}")
                     return {'success': False, 'error': 'Could not determine side from size for Hyperliquid'}
             else:
                  return {'success': False, 'error': 'Side or size is missing for closing position'}
        elif side is None:
             return {'success': False, 'error': 'Side is missing for closing position'}


        close_side = 'sell' if side.lower() == 'long' else 'buy'

        # Set common order parameters
        order_params = {
            'reduceOnly': True # Ensure this order only reduces the position
        }

        # Add exchange-specific parameters
        if exchange_name == 'bybit':
            order_params['category'] = 'linear' # Specify category for Bybit
        elif exchange_name == 'hyperliquid':
            # Calculate price with slippage for Hyperliquid
            slippage_percent = 1 # Default slippage
            if price is not None:
                try:
                    price_float = float(price)
                    slippage_multiplier = (100 - slippage_percent) / 100 if close_side == 'sell' else (100 + slippage_percent) / 100
                    price_with_slippage = price_float * slippage_multiplier

                except (ValueError, TypeError):
                    print(f"Could not parse price for slippage calculation: {price}")
                    return {'success': False, 'error': 'Invalid price for slippage calculation'}
            else:
                 return {'success': False, 'error': 'Price is required for Hyperliquid market orders'}

        # Create the market order
        # Conditionally include price for Hyperliquid
        if exchange_name == 'hyperliquid':
            order = exchange.exchange.create_order(
                symbol=symbol,
                type='market',
                side=close_side,
                amount=abs(float(size)), # Use absolute value for amount
                price=price_with_slippage, # Include price for Hyperliquid
                params=order_params
            )
        else:
            order = exchange.exchange.create_order(
                symbol=symbol,
                type='market',
                side=close_side,
                amount=abs(float(size)), # Use absolute value for amount
                params=order_params
            )

        print(f"Close order placed on {exchange_name}: {order}")

        return {'success': True, 'result': order}

    except Exception as e:
        print(f"Error closing position on {exchange_name}: {str(e)}")
        import traceback
        traceback.print_exc()

        # Special handling for Hyperliquid authentication errors
        if exchange_name == 'hyperliquid' and "privateKey" in str(e):
             return {
                 'success': False,
                 'error': str(e),
                 'auth_error': True,
                 'message': "Hyperliquid requires a private key for trading. Please check your API configuration."
             }

        return {'success': False, 'error': str(e)}


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

        result = close_position_unified(exchange_name, trade_data)

        if result and result.get('success', False):
            print("Trade closed successfully")
            return jsonify({'success': True, 'message': 'Trade closed successfully', 'result': result.get('result')})
        else:
            error_message = result.get('error', 'Failed to close trade') if result else 'Failed to close trade'
            print(f"Failed to close trade: {error_message}")
            # Check for auth error message from unified function
            if result and result.get('auth_error'):
                 error_message = result.get('message', error_message)
                 return jsonify({'success': False, 'error': error_message}), 401 # Use 401 for auth errors
            return jsonify({'success': False, 'error': error_message}), 500

    except Exception as e:
        print(f"An exception occurred while closing trade: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

@api_bp.route('/erase-db', methods=['POST'])
@login_required  # Protect this endpoint
def erase_database():
    """Erase cached database data"""
    try:
        if cache_manager.is_cache_available():
            # Call a method in CacheManager to clear the database
            cache_manager.clear_database()
            return jsonify({'success': True, 'message': 'Database erased successfully'})
        else:
            return jsonify({'success': False, 'error': 'No database connected'}), 400
    except Exception as e:
        print(f"Error erasing database: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@api_bp.route('/db-status', methods=['GET'])
@login_required  # Protect this endpoint
def get_db_status():
    """Check if database is connected"""
    try:
        is_available = cache_manager.is_cache_available()
        return jsonify({'success': True, 'is_available': is_available})
    except Exception as e:
        print(f"Error checking database status: {str(e)}")
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