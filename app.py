from flask import Flask
import os
from dotenv import load_dotenv
from auth import auth_bp # Import the authentication blueprint
from api_routes import api_bp # Import the API routes blueprint

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a_very_secret_key_fallback') # Replace with a strong secret key

# Register blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(api_bp)

# Use PORT environment variable for Railway
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)