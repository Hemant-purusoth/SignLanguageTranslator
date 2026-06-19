from flask import Flask
from flask_socketio import SocketIO, emit, join_room, leave_room
import numpy as np
import tensorflow as tf
import pickle
import os

app = Flask(__name__, static_folder=os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'Frontend')), static_url_path='/')
socketio = SocketIO(app, cors_allowed_origins="*")

# Make the socketio instance callable to support gunicorn deployments targeting app:socketio
SocketIO.__call__ = lambda self, environ, start_response: app(environ, start_response)


import json

# Define exactly which actions the active sequence model was trained on via JSON
def get_dynamic_actions():
    actions_list = []
    
    # Check Core Dataset
    core_path = os.path.join(os.path.dirname(__file__), '..', 'Frontend', 'app', 'data', 'dataset.json')
    if os.path.exists(core_path):
        with open(core_path, 'r') as f:
            data = json.load(f)
            actions_list.extend([w['label'] for w in data.get('words', []) if w.get('type') == 'dynamic'])
            
    # Check User Dataset
    user_path = os.path.join(os.path.dirname(__file__), '..', 'Frontend', 'app', 'data', 'user_dataset.json')
    if os.path.exists(user_path):
        with open(user_path, 'r') as f:
            data = json.load(f)
            actions_list.extend([w['label'] for w in data.get('words', []) if w.get('type') == 'dynamic'])
            
    return np.array(actions_list)

actions = get_dynamic_actions()
sequence_length = 30

# Load New LSTM Sequence Model (Dynamic)
try:
    model_path = os.path.join(os.path.dirname(__file__), 'action_model.h5')
    dynamic_model = tf.keras.models.load_model(model_path)
    print(f"[SUCCESS] LSTM Sequence Model loaded successfully from {model_path}")
except Exception as e:
    print(f"[ERROR] Error loading sequence model: {e}")
    dynamic_model = None

# Load Old Random Forest Model (Static)
try:
    static_model_path = os.path.join(os.path.dirname(__file__), 'model.p')
    with open(static_model_path, 'rb') as f:
        model_dict = pickle.load(f)
        static_model = model_dict['model']
    print(f"[SUCCESS] Static ML Model loaded successfully from {static_model_path}")
except Exception as e:
    print(f"[ERROR] Error loading static model: {e}")
    static_model = None

# Global state
sequence_buffer = []
current_mode = "dynamic"  # defaults to dynamic

from flask import redirect
@app.route('/')
def home():
    return redirect('/landing/index2.html')

@socketio.on('set_mode')
def handle_set_mode(data):
    """Frontend calls this when starting practice to tell us what model to use"""
    global sequence_buffer, current_mode
    sequence_buffer = []  # clear memory
    
    # Handle dictionary payload from js
    if isinstance(data, dict) and 'type' in data:
        current_mode = data['type']
    else:
        current_mode = "dynamic"
        
    print(f"Practice Started. Backend Mode set to: {current_mode.upper()}")

@socketio.on('video_frame')
def handle_frame(data):
    """
    Receives an array of 63 floats representing the xyz coordinates
    of the 21 hand landmarks for a single frame.
    """
    global sequence_buffer, current_mode

    try:
        # data should be a list of 63 floats from the frontend
        landmarks_xyz = np.array(data)
        
        # ---------------------------------------------------------
        # STATIC MODE ROUTING 
        # (Uses single frame, expects 42 (x,y) features)
        # ---------------------------------------------------------
        if current_mode == "static":
            if static_model is None:
                return
                
            # The static model was trained on x and y only. We must ignore z.
            data_aux = []
            for i in range(0, 63, 3):
                data_aux.append(landmarks_xyz[i])   # x
                data_aux.append(landmarks_xyz[i+1]) # y
                
            prediction = static_model.predict([data_aux])
            label = prediction[0]
            probability = np.max(static_model.predict_proba([data_aux]))
            
            # Send prediction immediately (no sequence buffering needed)
            emit('prediction', {'label': label, 'confidence': float(probability)})


        # ---------------------------------------------------------
        # DYNAMIC MODE ROUTING 
        # (Uses 30 frames, expects 63 (x,y,z) features)
        # ---------------------------------------------------------
        elif current_mode == "dynamic":
            if dynamic_model is None:
                return
                
            # Append the new frame's landmarks to our continuous sequence memory
            sequence_buffer.append(landmarks_xyz)
            
            # Keep only the last 30 frames
            if len(sequence_buffer) > sequence_length:
                sequence_buffer = sequence_buffer[-sequence_length:]
                
            # Once we have 30 frames, we can make a prediction
            if len(sequence_buffer) == sequence_length:
                # Shape for prediction must be (1, 30, 63)
                input_sequence = np.expand_dims(sequence_buffer, axis=0)
                
                # Predict
                res = dynamic_model.predict(input_sequence, verbose=0)[0]
                
                # Get the highest probability class index
                action_idx = np.argmax(res)
                confidence = float(res[action_idx])
                label = actions[action_idx]
                
        # ---------------------------------------------------------
        # BOTH MODE ROUTING (used in Video Call)
        # ---------------------------------------------------------
        elif current_mode == "both":
            best_label = None
            best_confidence = 0.0
            
            # 1. Evaluate Static Model
            static_prob = 0.0
            if static_model is not None:
                data_aux = []
                for i in range(0, 63, 3):
                    data_aux.append(landmarks_xyz[i])
                    data_aux.append(landmarks_xyz[i+1])
                
                static_prob = float(np.max(static_model.predict_proba([data_aux])))
                if static_prob > 0.75: # Priority threshold for static signs
                    best_label = static_model.predict([data_aux])[0]
                    best_confidence = static_prob
                    
            # 2. Evaluate Dynamic Model
            if dynamic_model is not None:
                sequence_buffer.append(landmarks_xyz)
                if len(sequence_buffer) > sequence_length:
                    sequence_buffer = sequence_buffer[-sequence_length:]
                    
                if len(sequence_buffer) == sequence_length:
                    input_sequence = np.expand_dims(sequence_buffer, axis=0)
                    res = dynamic_model.predict(input_sequence, verbose=0)[0]
                    action_idx = np.argmax(res)
                    dynamic_prob = float(res[action_idx])
                    
                    # Because the Dynamic Model only knows a few signs (no "idle" class),
                    # it will often output 99% confidence for resting hands. 
                    # We ONLY trust it if the Static model isn't currently highly confident.
                    if dynamic_prob > 0.85 and static_prob < 0.75:
                        best_label = actions[action_idx]
                        best_confidence = dynamic_prob
                        
            # Emit result
            if best_label is not None:
                emit('prediction', {'label': best_label, 'confidence': best_confidence})
            
    except Exception as e:
        print("Error processing frame:", e)

import json
import shutil
import csv

@socketio.on('collect_frame')
def handle_collect(payload):
    """Receives data from the web Train Dashboard and saves it to disk."""
    action = payload.get('action')
    gtype = payload.get('type')
    seq = payload.get('sequence', 0)
    frame = payload.get('frame', 0)
    data = payload.get('data', [])
    
    if gtype == 'static':
        # Append as a single row to dataset.csv
        csv_path = os.path.join(os.path.dirname(__file__), 'dataset.csv')
        file_exists = os.path.isfile(csv_path)
        with open(csv_path, mode='a', newline='') as f:
            writer = csv.writer(f)
            if not file_exists:
                headers = ['label']
                for i in range(21):
                    headers.extend([f'x{i}', f'y{i}'])
                writer.writerow(headers)
            
            # Static expects 42 coordinates (x, y) which the JS frontend already prepared perfectly
            row = [action] + data
            writer.writerow(row)
            
    elif gtype == 'dynamic':
        # Save as a .npy file inside MP_Data/action/seq/frame.npy
        base_path = os.path.join(os.path.dirname(__file__), 'MP_Data', action, str(seq))
        os.makedirs(base_path, exist_ok=True)
        npy_path = os.path.join(base_path, f"{frame}.npy")
        np.save(npy_path, np.array(data))

@socketio.on('recording_complete')
def handle_recording_complete(payload):
    """Marks a gesture as successfully recorded in user_dataset.json"""
    label = payload.get('label')
    gtype = payload.get('type')
    
    user_json_path = os.path.join(os.path.dirname(__file__), '..', 'Frontend', 'app', 'data', 'user_dataset.json')
    try:
        with open(user_json_path, 'r') as f:
            data = json.load(f)
            
        data['words'].append({'label': label, 'type': gtype})
        
        with open(user_json_path, 'w') as f:
            json.dump(data, f, indent=4)
            
        print(f"[SUCCESS] User Gesture '{label}' saved to database.")
    except Exception as e:
        print(f"Error saving to user_dataset.json: {e}")

@socketio.on('delete_gesture')
def handle_delete(payload):
    label = payload.get('label')
    
    # 1. Remove from JSON
    user_json_path = os.path.join(os.path.dirname(__file__), '..', 'Frontend', 'app', 'data', 'user_dataset.json')
    try:
        with open(user_json_path, 'r') as f:
            data = json.load(f)
        data['words'] = [w for w in data['words'] if w['label'] != label]
        with open(user_json_path, 'w') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        pass
        
    # 2. Remove files 
    mp_dir = os.path.join(os.path.dirname(__file__), 'MP_Data', label)
    if os.path.exists(mp_dir):
        shutil.rmtree(mp_dir)
        print(f"[DELETED] Deleted folder: {mp_dir}")
        
    csv_path = os.path.join(os.path.dirname(__file__), 'dataset.csv')
    if os.path.exists(csv_path):
        import pandas as pd
        try:
            df = pd.read_csv(csv_path)
            # Filter out the rows where the label matches
            df = df[df.iloc[:, 0] != label]
            df.to_csv(csv_path, index=False)
            print(f"[DELETED] Cleaned {label} from dataset.csv")
        except Exception:
            pass

import sys
import subprocess
import os

@socketio.on('trigger_training')
def handle_train():
    print("[START] Background Training Triggered via Web Dashboard")
    try:
        backend_dir = os.path.dirname(os.path.abspath(__file__))
        # Run explicitly using the SAME python executable that is running app.py
        subprocess.run([sys.executable, 'train_model.py'], cwd=backend_dir, check=True)
        subprocess.run([sys.executable, 'train_sequence_model.py'], cwd=backend_dir, check=True)
        emit('training_complete')
    except Exception as e:
        print("Training error:", e)

# ==========================================
# WEBRTC SIGNALING & VIDEO CALL HANDLERS
# ==========================================

@socketio.on('join-room')
def handle_join_room(room_id):
    # Flask-SocketIO rooms dictionary structure:
    # socketio.server.manager.rooms[nsp][room] gives a dict of sids
    rooms = socketio.server.manager.rooms.get('/', {})
    
    # Check current participants in the requested room
    participants = rooms.get(room_id, {})
    num_users = len(participants)
    
    if num_users >= 2:
        print(f"[ERROR] Rejected: Room {room_id} is full (has {num_users} users).")
        emit('room-full', room_id)
        return
        
    join_room(room_id)
    
    # Re-check after joining
    participants_after = rooms.get(room_id, {})
    num_users_after = len(participants_after)
    
    if num_users_after == 1:
        print(f"[INFO] Room CREATED: {room_id} by first user.")
        emit('room-created', room_id)
    else:
        print(f"[JOINED] User JOINED room: {room_id}. Room now full ({num_users_after}/2).")
        # Notify others in the room that someone new joined
        emit('user-joined', room_id, to=room_id, include_self=False)

@socketio.on('signal')
def handle_signal(data):
    # Relay WebRTC signaling data (offer, answer, ICE candidates) to the room
    room_id = data.get('to')
    emit('signal', {'signal': data.get('signal')}, to=room_id, include_self=False)

@socketio.on('translation')
def handle_translation(data):
    # Relay finished text strings from Speech API or frontend sequence builder
    room_id = data.get('room')
    emit('translation', {
        'text': data.get('text'),
        'final': data.get('final', False)
    }, to=room_id, include_self=False)

@socketio.on('clear_sequence')
def handle_clear_sequence():
    global sequence_buffer
    sequence_buffer = []

if __name__ == '__main__':
    import os

    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host='0.0.0.0', port=port)
