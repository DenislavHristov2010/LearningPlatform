# Learning Platform with FastAPI AI Integration

This is a learning platform that uses FastAPI for AI-powered lesson generation and chat functionality.

## Setup

1. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```

2. Set your GROQ API key as an environment variable:
   ```
   export GROQ_API_KEY=your_api_key_here
   ```
   Or edit `main.py` and set it directly.

3. Run the FastAPI server:
   ```
   python main.py
   ```

4. Open `index.html` in your web browser.

The frontend will communicate with the FastAPI backend running on `http://localhost:8000`.

## Features

- Generate lessons for various subjects and grades
- AI chat assistant for each lesson
- Save lessons locally
- Bulgarian language interface

## API Endpoints

- `POST /generate-lesson`: Generate HTML content for a lesson
- `POST /chat`: Get AI response for chat messages