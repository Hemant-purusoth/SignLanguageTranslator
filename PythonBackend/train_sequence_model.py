import os
import numpy as np
import json
from sklearn.model_selection import train_test_split
from tensorflow.keras.utils import to_categorical
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense
from tensorflow.keras.callbacks import TensorBoard

# Data structure mapping
DATA_PATH = os.path.join(os.path.dirname(__file__), 'MP_Data')

# Define exactly which actions we want to classify dynamically from JSON
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

# Match these exactly with collect_sequence_data.py
no_sequences = 30
sequence_length = 30

def load_data():
    """
    Scans the MP_Data folder to combine individual numpy frame arrays
    into sequences [sequence_length, 63] for LSTM training.
    """
    label_map = {label:num for num, label in enumerate(actions)}

    sequences, labels = [], []
    for action in actions:
        action_path = os.path.join(DATA_PATH, action)
        if not os.path.exists(action_path):
            print(f"Warning: Data folder for action '{action}' not found. Skipping.")
            continue
            
        for sequence in range(no_sequences):
            window = []
            valid_sequence = True
            for frame_num in range(sequence_length):
                npy_path = os.path.join(action_path, str(sequence), f"{frame_num}.npy")
                
                # Check if file exists to prevent crashing if data is incomplete
                if os.path.exists(npy_path):
                    res = np.load(npy_path)
                    window.append(res)
                else:
                    valid_sequence = False
                    break
                    
            if valid_sequence and len(window) == sequence_length:
                sequences.append(window)
                labels.append(label_map[action])

    X = np.array(sequences)
    
    # Check if any data was loaded
    if X.size == 0:
        print("ERROR: No valid sequences found in MP_Data. Please collect data first.")
        return None, None
        
    y = to_categorical(labels, num_classes=len(actions)).astype(int)
    
    return X, y

def build_and_train_model():
    print("Loading data from MP_Data directory...")
    X, y = load_data()
    
    if X is None or y is None:
        return

    print(f"Successfully loaded {X.shape[0]} sequences of {sequence_length} frames.")
    print(f"Data shape: {X.shape}") # Should be (number_of_videos, 30, 63)
    
    # Split the data into train (90%) and test (10%) sets
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.1)

    # -------------------------
    # Building the LSTM Model
    # -------------------------
    print("Building LSTM Neural Network Model...")
    
    # Log for tensorboard
    log_dir = os.path.join(os.path.dirname(__file__), 'Logs')
    tb_callback = TensorBoard(log_dir=log_dir)

    model = Sequential()
    # 3 LSTM layers to find patterns over time
    model.add(LSTM(64, return_sequences=True, activation='relu', input_shape=(sequence_length, 63)))
    model.add(LSTM(128, return_sequences=True, activation='relu'))
    model.add(LSTM(64, return_sequences=False, activation='relu'))
    
    # Fully connected layers to make final decision
    model.add(Dense(64, activation='relu'))
    model.add(Dense(32, activation='relu'))
    model.add(Dense(actions.shape[0], activation='softmax')) # Output layer predicting specific action

    # Compile the model
    model.compile(optimizer='Adam', loss='categorical_crossentropy', metrics=['categorical_accuracy'])

    # -------------------------
    # Train the model
    # -------------------------
    print("\nStarting Training... (This may take a few minutes depending on your computer)")
    model.fit(X_train, y_train, epochs=200, callbacks=[tb_callback])

    # -------------------------
    # Save the generated model
    # -------------------------
    model_save_path = os.path.join(os.path.dirname(__file__), 'action_model.h5')
    model.save(model_save_path)
    print(f"\nTraining complete! Model saved to {model_save_path}")

if __name__ == "__main__":
    build_and_train_model()
    
