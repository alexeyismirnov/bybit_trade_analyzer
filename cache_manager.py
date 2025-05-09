import json
import time
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, Text, DateTime, Boolean, Float, select, and_, func, update, BigInteger

class CacheManager:
    """Manages database caching of trade data"""
    
    def __init__(self, db_url=None):
        """Initialize the cache manager with database connection"""
        self.engine = None
        self.trades_table = None
        self.cache_ranges_table = None
        
        if not db_url:
            print("No database URL provided, caching disabled")
            return
        
        try:
            # Handle potential Heroku PostgreSQL URL format
            if db_url.startswith("postgres://"):
                db_url = db_url.replace("postgres://", "postgresql://", 1)
            
            self.engine = create_engine(db_url)
            metadata = MetaData()
            
            # Define trades table
            self.trades_table = Table(
                'trades', 
                metadata,
                Column('id', Integer, primary_key=True),
                Column('symbol', String(20)),
                Column('side', String(10)),
                Column('avgEntryPrice', String(30)),
                Column('avgExitPrice', String(30)),
                Column('qty', String(30)),
                Column('closedPnl', String(30)),
                Column('updatedTime', String(30)),
                Column('roi', Float),
                Column('formatted_time', String(30)),
                Column('created_at', String(30)),
                Column('raw_data', Text),  # Store the full JSON for future use
                Column('fetched_at', DateTime, default=datetime.utcnow)
            )
            
            # Define cache ranges table to track what time ranges we've cached
            # Removed is_complete field as we assume data is always complete
            self.cache_ranges_table = Table(
                'cache_ranges',
                metadata,
                Column('id', Integer, primary_key=True),
                Column('symbol', String(20), nullable=True),  # null means "all symbols"
                Column('oldest_timestamp', String(30)),  # oldest trade timestamp we have cached (ms)
                Column('newest_timestamp', String(30)),  # newest trade timestamp we have cached (ms)
                Column('last_updated', DateTime, default=datetime.utcnow)
            )
            
            # Create tables if they don't exist
            metadata.create_all(self.engine)
            print("Database connection established successfully.")
        except Exception as e:
            print(f"Error connecting to database: {e}")
            self.engine = None
    
    def is_cache_available(self):
        """Check if caching is available"""
        return self.engine is not None and self.trades_table is not None and self.cache_ranges_table is not None
    
    def get_cached_range(self, symbol=None):
        """Get cached time range for a symbol from the database"""
        if not self.is_cache_available():
            return None  # No database or table
        
        try:
            with self.engine.connect() as conn:
                # Build query to get cache range for this symbol
                # SQLAlchemy 2.x syntax
                query = select(self.cache_ranges_table)
                
                # Either match the symbol or get range for "all symbols" (null symbol)
                if symbol:
                    query = query.where(self.cache_ranges_table.c.symbol == symbol)
                else:
                    query = query.where(self.cache_ranges_table.c.symbol == None)
                
                # Execute query
                row = conn.execute(query).fetchone()
                
                if not row:
                    return None  # No cache range found
                
                # Return as a simple dictionary
                return {
                    'symbol': row.symbol,
                    'oldest_timestamp': int(row.oldest_timestamp),
                    'newest_timestamp': int(row.newest_timestamp),
                    'last_updated': row.last_updated
                    # Removed is_complete field
                }
        
        except Exception as e:
            print(f"Error retrieving cached range: {e}")
            return None
    
    def get_uncached_ranges(self, cached_range, start_time, end_time):
        """
        Determine which time ranges need to be fetched from API
        Returns a list of (start, end) tuples for uncached ranges
        """
        # Convert to integers to ensure proper comparison
        start_time = int(start_time)
        end_time = int(end_time)
        
        # If no cached range, the entire requested range is uncached
        if not cached_range:
            return [(start_time, end_time)]
        
        # Initialize list of uncached ranges
        uncached_ranges = []
        
        oldest = cached_range['oldest_timestamp']
        newest = cached_range['newest_timestamp']
        
        # Check if there's a gap before the cached range
        if start_time < oldest:
            uncached_ranges.append((start_time, oldest - 1))
        
        # Check if there's a gap after the cached range
        if end_time > newest:
            uncached_ranges.append((newest + 1, end_time))
        
        return uncached_ranges
    
    def get_cached_trades(self, symbol=None, start_time=None, end_time=None):
        """Get cached trades from the database for a specific time period"""
        if not self.is_cache_available():
            return []  # Database not available
        
        try:
            with self.engine.connect() as conn:
                # Build query based on parameters
                # SQLAlchemy 2.x syntax
                query = select(self.trades_table)
                conditions = []
                
                if symbol:
                    conditions.append(self.trades_table.c.symbol == symbol)
                
                if start_time:
                    # Convert milliseconds to seconds for comparison
                    conditions.append(
                        func.cast(self.trades_table.c.updatedTime, BigInteger) >= start_time
                    )
                
                if end_time:
                    conditions.append(
                        func.cast(self.trades_table.c.updatedTime, BigInteger) <= end_time
                    )
                
                if conditions:
                    query = query.where(and_(*conditions))
                
                # Execute query
                result = conn.execute(query)
                trades = []
                
                for row in result:
                    # Convert row to dict
                    trade = {column: getattr(row, column) for column in row._fields if column != 'raw_data' and column != 'id' and column != 'fetched_at'}
                    
                    # If raw_data is available, use it as base and update with processed fields
                    if row.raw_data:
                        try:
                            raw_trade = json.loads(row.raw_data)
                            raw_trade.update(trade)
                            trade = raw_trade
                        except:
                            pass  # If raw_data parsing fails, use the basic trade data
                    
                    trades.append(trade)
                
                print(f"Retrieved {len(trades)} cached trades for {symbol or 'all symbols'}")
                return trades
        
        except Exception as e:
            print(f"Error retrieving cached trades: {e}")
            return []
    
    def cache_trades(self, trades, process_trade_func=None):
        """Cache trades in the database"""
        if not self.is_cache_available() or not trades:
            return  # Database not available or no trades to cache
        
        try:
            # Use a transaction to ensure all inserts are committed
            with self.engine.begin() as conn:
                for trade in trades:
                    # Check if trade already exists
                    # SQLAlchemy 2.x syntax
                    query = select(self.trades_table).where(self.trades_table.c.updatedTime == trade['updatedTime'])
                    if 'symbol' in trade:
                        query = query.where(self.trades_table.c.symbol == trade['symbol'])
                    
                    existing = conn.execute(query).fetchone()
                    
                    if not existing:
                        # Process the trade to calculate ROI and format timestamps
                        processed_trade = dict(trade)
                        if process_trade_func:
                            process_trade_func(processed_trade)
                        
                        # Prepare data for insertion
                        insert_data = {
                            'symbol': trade.get('symbol', ''),
                            'side': trade.get('side', ''),
                            'avgEntryPrice': trade.get('avgEntryPrice', ''),
                            'avgExitPrice': trade.get('avgExitPrice', ''),
                            'qty': trade.get('qty', ''),
                            'closedPnl': trade.get('closedPnl', ''),
                            'updatedTime': trade.get('updatedTime', ''),
                            'roi': processed_trade.get('roi', 0),
                            'formatted_time': processed_trade.get('formatted_time', ''),
                            'created_at': str(int(int(trade.get('updatedTime', '0'))/1000)),
                            'raw_data': json.dumps(trade),
                            'fetched_at': datetime.utcnow()
                        }
                        
                        # Insert into database
                        conn.execute(self.trades_table.insert().values(**insert_data))
                
                # Transaction will be automatically committed here
                print(f"Cached {len(trades)} trades in database")
        
        except Exception as e:
            print(f"Error caching trades: {e}")
    
    def update_cache_ranges(self, symbol, start_time, end_time):
        """Update the cache_ranges table with new information"""
        if not self.is_cache_available():
            return
        
        try:
            # Use a transaction to ensure all updates are committed
            with self.engine.begin() as conn:
                # Find the actual min and max timestamps of trades we have for this symbol and range
                # SQLAlchemy 2.x syntax
                min_query = select(func.min(self.trades_table.c.updatedTime))
                max_query = select(func.max(self.trades_table.c.updatedTime))
                
                conditions = []
                if symbol:
                    conditions.append(self.trades_table.c.symbol == symbol)
                
                if start_time:
                    conditions.append(func.cast(self.trades_table.c.updatedTime, BigInteger) >= start_time)
                
                if end_time:
                    conditions.append(func.cast(self.trades_table.c.updatedTime, BigInteger) <= end_time)
                
                if conditions:
                    min_query = min_query.where(and_(*conditions))
                    max_query = max_query.where(and_(*conditions))
                
                oldest_timestamp = conn.execute(min_query).scalar()
                newest_timestamp = conn.execute(max_query).scalar()
                
                if not oldest_timestamp or not newest_timestamp:
                    return  # No trades found
                
                # Check if a range entry already exists for this symbol
                # SQLAlchemy 2.x syntax
                query = select(self.cache_ranges_table)
                if symbol:
                    query = query.where(self.cache_ranges_table.c.symbol == symbol)
                else:
                    query = query.where(self.cache_ranges_table.c.symbol == None)
                
                existing_range = conn.execute(query).fetchone()
                
                now = datetime.utcnow()
                
                if existing_range:
                    # Update existing range - expand the time range if needed
                    update_stmt = update(self.cache_ranges_table)
                    
                    if symbol:
                        update_stmt = update_stmt.where(self.cache_ranges_table.c.symbol == symbol)
                    else:
                        update_stmt = update_stmt.where(self.cache_ranges_table.c.symbol == None)
                    
                    update_data = {
                        'oldest_timestamp': min(int(existing_range.oldest_timestamp), int(oldest_timestamp)),
                        'newest_timestamp': max(int(existing_range.newest_timestamp), int(newest_timestamp)),
                        'last_updated': now
                    }
                    
                    conn.execute(update_stmt.values(**update_data))
                    print(f"Updated cache range for {symbol or 'all symbols'}: {update_data['oldest_timestamp']} to {update_data['newest_timestamp']}")
                else:
                    # Insert new range
                    insert_data = {
                        'symbol': symbol,
                        'oldest_timestamp': oldest_timestamp,
                        'newest_timestamp': newest_timestamp,
                        'last_updated': now
                        # Removed is_complete field
                    }
                    
                    conn.execute(self.cache_ranges_table.insert().values(**insert_data))
                    print(f"Created new cache range for {symbol or 'all symbols'}: {oldest_timestamp} to {newest_timestamp}")
                
                # Transaction will be automatically committed here
        
        except Exception as e:
            print(f"Error updating cache ranges: {e}")
    
    def get_most_recent_fetch_time(self, symbol=None, start_time=None, end_time=None):
        """Get the most recent fetch time for trades in a period"""
        if not self.is_cache_available():
            return None
        
        try:
            with self.engine.connect() as conn:
                # Build query to get the most recent fetched_at time
                # SQLAlchemy 2.x syntax
                query = select(func.max(self.trades_table.c.fetched_at))
                conditions = []
                
                if symbol:
                    conditions.append(self.trades_table.c.symbol == symbol)
                
                if start_time:
                    conditions.append(
                        func.cast(self.trades_table.c.updatedTime, BigInteger) >= start_time
                    )
                
                if end_time:
                    conditions.append(
                        func.cast(self.trades_table.c.updatedTime, BigInteger) <= end_time
                    )
                
                if conditions:
                    query = query.where(and_(*conditions))
                
                # Execute query
                result = conn.execute(query).scalar()
                return result
        
        except Exception as e:
            print(f"Error getting most recent fetch time: {e}")
            return None