# Sign Language Translator & Video Call

A web application that translates sign language in real-time during secure peer-to-peer video calls.

Live link : https://signlanguagetranslator-dzvr.onrender.com/landing/index2.html

## Features
* **Real-time Translation:** Instantly translates hand gestures into text captions.
* **Secure Video Calling:** 1-on-1 WebRTC video rooms using unique room codes.
* **Custom Training:** Record and train your own custom gestures directly from your browser.

---

## Project Structure
* **Frontend/**: Web pages (`index.html`, `videocall.html`, `train.html`) and JavaScript logic for camera tracking (MediaPipe) and WebRTC.
* **PythonBackend/**: Flask-SocketIO server that runs the WebRTC signaling and AI models (Random Forest for static letters, LSTM for dynamic actions).

---

## Installation & Setup

1. **Install requirements:**
   ```bash
   pip install flask flask-socketio numpy tensorflow scikit-learn pandas opencv-python mediapipe h5py
   ```

2. **Start the server:**
   ```bash
   cd PythonBackend
   python app.py
   ```

3. **Open the app:**
   Go to `http://localhost:5000` in your web browser.
