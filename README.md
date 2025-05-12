# Bybit Trade Analyzer

A web application that fetches and analyzes trading data from Bybit's API, providing visualizations and analytics for both completed and open trades.

## Features

- **Trade Data Retrieval**:
  - Fetch completed trades from Bybit API with customizable date ranges
  - Retrieve current open positions
  - Database caching system for improved performance and reduced API calls

- **Data Visualization**:
  - Cumulative PnL chart showing profit/loss over time
  - Trade distribution pie chart (wins/losses/draws)
  - Responsive charts that adapt to different time periods

- **Trade Analysis**:
  - Detailed tables for both completed and open trades
  - Calculate and display ROI for each trade
  - Performance metrics (win rate, average ROI, total PnL)
  - Symbol filtering for targeted analysis

- **User Interface**:
  - Responsive design using Bootstrap
  - Pagination for large datasets
  - Sortable and filterable tables
  - Time period selection (7D, 30D, 90D, 180D, 1Y)

## Prerequisites

- Python 3.7+
- Bybit API credentials (API key and secret)
- PostgreSQL database (optional, for caching)

## Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/bybit-trade-analyzer.git
   cd bybit-trade-analyzer
   ```

2. Install the required packages:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file in the root directory with your Bybit API credentials:
```
BYBIT_API_KEY=your_api_key_here 
BYBIT_API_SECRET=your_api_secret_here 
DATABASE_URL=your_database_url_here # Optional, for caching
```

4. Run the application:
```bash
python app.py
```

Open your browser and navigate to http://localhost:5000
