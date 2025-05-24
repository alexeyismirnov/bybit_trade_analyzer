import os
from flask import Blueprint, render_template, request, redirect, url_for, session
from functools import wraps
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Authentication credentials (loaded from environment variables)
AUTH_USERNAME = os.environ.get('AUTH_USERNAME')
AUTH_PASSWORD = os.environ.get('AUTH_PASSWORD')

auth_bp = Blueprint('auth', __name__)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('auth.login')) # Use blueprint name for url_for
        return f(*args, **kwargs)
    return decorated_function

@auth_bp.route('/')
def login():
    """Render the login page"""
    if 'logged_in' in session:
        return redirect(url_for('auth.dashboard')) # Use blueprint name for url_for
    return render_template('login.html')

@auth_bp.route('/login', methods=['POST'])
def do_login():
    """Handle login form submission"""
    username = request.form.get('username')
    password = request.form.get('password')

    if username == AUTH_USERNAME and password == AUTH_PASSWORD:
        session.permanent = True
        session['logged_in'] = True
        return redirect(url_for('auth.dashboard')) # Use blueprint name for url_for
    else:
        return render_template('login.html', error='Invalid credentials')

@auth_bp.route('/logout')
def logout():
    """Handle logout"""
    session.pop('logged_in', None)
    return redirect(url_for('auth.login')) # Use blueprint name for url_for

@auth_bp.route('/dashboard')
@login_required
def dashboard():
    """Render the dashboard page"""
    return render_template('dashboard.html')