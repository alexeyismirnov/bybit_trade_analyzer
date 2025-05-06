from flask import Flask, render_template, jsonify, request
import os
import requests
import time
import hmac
import hashlib
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Bybit API credentials (loaded from environment variables)
API_KEY = os.environ.get('BYBIT_API_KEY', '')
API_SECRET = os.environ.get('BYBIT_API_SECRET', '')

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

@app.route('/')
def index():
    """Render the main page"""
    return render_template('index.html')

@app.route('/api/trades')
def get_trades():
    """Fetch completed USDT Perpetual trades from Bybit Unified Account"""
    try:
        # Get query parameters
        symbol = request.args.get('symbol', None)
        days = request.args.get('days', None)
        
        # Calculate the target date range
        end_time = int(time.time() * 1000)  # Current time in milliseconds
        start_time = end_time
        if days and days.isdigit():
            days = int(days)
            start_time = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
        
        # Collect all trades within the specified time range
        all_trades = []
        
        # Start from the end_time and work backwards in 7-day chunks
        current_end = end_time
        current_start = max(current_end - (7 * 24 * 60 * 60 * 1000), start_time)  # 7 days in milliseconds or start_time
        
        # We'll make up to 20 requests to cover longer time periods
        max_requests = 20
        request_count = 0
        
        while current_start >= start_time and request_count < max_requests:
            # Fetch trades for this 7-day window
            batch_trades = fetch_trades(symbol, current_start, current_end)
            
            # Add to our collection
            all_trades.extend(batch_trades)
            
            # Log progress
            print(f"Fetched {len(batch_trades)} trades from {datetime.fromtimestamp(current_start/1000)} to {datetime.fromtimestamp(current_end/1000)}")
            
            # Move to the next 7-day window
            current_end = current_start - 1
            current_start = max(current_end - (7 * 24 * 60 * 60 * 1000), start_time)
            
            # If we've reached the start_time, we're done
            if current_end <= start_time:
                break
                
            request_count += 1
            
            # Add a small delay between requests
            time.sleep(0.5)
        
        # Process all trades (calculate ROI, format timestamps, etc.)
        for trade in all_trades:
            process_trade(trade)
        
        # Sort all trades by timestamp (newest first for display)
        all_trades.sort(key=lambda x: int(x.get('updatedTime', 0)), reverse=True)
        
        return jsonify({'success': True, 'trades': all_trades})
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def fetch_trades(symbol=None, start_time=None, end_time=None):
    """Helper function to fetch trades with proper signature generation"""
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
        return data['result']['list']
    else:
        error_msg = f"API Error: {data.get('retMsg', 'Unknown error')} (Code: {data.get('retCode', 'Unknown')})"
        print(error_msg)  # Log the error
        return []

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
            trade['formatted_time'] = datetime.fromtimestamp(timestamp_ms/1000).strftime('%Y-%m-%d %H:%M:%S')
    
    # Map V5 API field names to match our frontend expectations
    trade['symbol'] = trade.get('symbol', '')
    trade['side'] = trade.get('side', '')
    trade['entry_price'] = trade.get('avgEntryPrice', '')
    trade['exit_price'] = trade.get('avgExitPrice', '')
    trade['qty'] = trade.get('qty', '')
    trade['closed_pnl'] = trade.get('closedPnl', '')
    trade['created_at'] = str(int(int(trade.get('updatedTime', '0'))/1000))  # Convert to seconds

# Use PORT environment variable for Railway
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)