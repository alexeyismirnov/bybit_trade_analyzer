from flask import Flask, render_template, jsonify, request
import os
import requests
import time
import hmac
import hashlib
import json
import urllib.parse
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Bybit API credentials (loaded from environment variables)
API_KEY = os.environ.get('BYBIT_API_KEY', '')
API_SECRET = os.environ.get('BYBIT_API_SECRET', '')

def get_bybit_signature(timestamp, api_secret, recv_window, params=None):
    """
    Generate signature for Bybit V5 API authentication
    For GET requests: timestamp+api_key+recv_window+query_string
    For POST requests: timestamp+api_key+recv_window+request_body
    """
    param_str = timestamp + API_KEY + recv_window
    
    # Add query parameters if provided (for GET requests)
    if params:
        query_string = '&'.join([f"{k}={v}" for k, v in sorted(params.items())])
        if query_string:
            param_str += query_string
    
    signature = hmac.new(
        bytes(api_secret, 'utf-8'),
        msg=bytes(param_str, 'utf-8'),
        digestmod=hashlib.sha256
    ).hexdigest()
    
    return signature

@app.route('/')
def index():
    """Render the main page"""
    return render_template('index.html')

@app.route('/api/symbols')
def get_symbols():
    """Fetch available USDT Perpetual trading pairs from Bybit"""
    try:
        # V5 API endpoint for linear (USDT) perpetual symbols
        url = "https://api.bybit.com/v5/market/instruments-info?category=linear"
        response = requests.get(url)
        data = response.json()
        
        if data['retCode'] == 0 and 'list' in data['result']:
            # Filter for USDT perpetual symbols only
            symbols = [item['symbol'] for item in data['result']['list'] if item['symbol'].endswith('USDT')]
            return jsonify({'success': True, 'symbols': symbols})
        else:
            return jsonify({'success': False, 'error': data.get('retMsg', 'Failed to fetch symbols')})

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/trades')
def get_trades():
    """Fetch completed USDT Perpetual trades from Bybit Unified Account"""
    try:
        timestamp = str(int(time.time() * 1000))
        recv_window = "5000"
        
        # Get symbol from query parameter
        symbol = request.args.get('symbol', None)
        
        # Base parameters - always use 'linear' category for USDT Perpetual
        params = {
            'category': 'linear',
            'limit': '50'
        }
        
        # Add symbol if specified
        if symbol:
            params['symbol'] = symbol
        
        # Generate signature with parameters
        signature = get_bybit_signature(timestamp, API_SECRET, recv_window, params)
        
        # V5 API endpoint for closed positions in Unified account
        url = "https://api.bybit.com/v5/position/closed-pnl"
        
        headers = {
            'X-BAPI-SIGN': signature,
            'X-BAPI-API-KEY': API_KEY,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': recv_window
        }
        
        # Make the request
        response = requests.get(url, headers=headers, params=params)
        data = response.json()
        
        if data['retCode'] == 0 and 'list' in data['result']:
            trades = data['result']['list']
            
            # Process the trades
            for trade in trades:
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
            
            return jsonify({'success': True, 'trades': trades})
        else:
            error_msg = f"API Error: {data.get('retMsg', 'Unknown error')} (Code: {data.get('retCode', 'Unknown')})"
            return jsonify({'success': False, 'error': error_msg})
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    app.run(debug=True)