import os
import cv2
import mediapipe as mp
import csv
import sys
import numpy as np

# Setup MediaPipe
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
hands = mp_hands.Hands(static_image_mode=True, min_detection_confidence=0.3)

DATA_FILE = 'dataset.csv'

# Define the static words you want to train here
WORDS_TO_TRAIN = ["Hello", "Thanks", "Yes", "No","today","bad"]
SAMPLES_PER_WORD = 200

def initialize_csv():
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'w', newline='') as f:
            writer = csv.writer(f)
            # Create headers: label, x0, y0, x1, y1, ... x20, y20
            headers = ['label']
            for i in range(21):
                headers.extend([f'x{i}', f'y{i}'])
            writer.writerow(headers)

def save_landmarks(label, landmarks):
    with open(DATA_FILE, 'a', newline='') as f:
        writer = csv.writer(f)
        row = [label]
        for lm in landmarks:
            row.extend([lm.x, lm.y])
        writer.writerow(row)

def run(camera_id):
    initialize_csv()
    cap = cv2.VideoCapture(int(camera_id))
    
    print("\n🎥 Starting Data Collection Protocol...")
    
    for word in WORDS_TO_TRAIN:
        print(f"\n======================================")
        print(f"👉 Get ready for: {word}")
        print(f"Press 'S' to start collecting {SAMPLES_PER_WORD} samples.")
        print(f"Press 'Q' to quit completely.")
        print(f"======================================\n")
        
        collecting = False
        sample_count = 0
        
        while True:
            ret, frame = cap.read()
            if not ret: break

            frame = cv2.flip(frame, 1) # Mirror the frame to make it intuitive
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(frame_rgb)
            
            # Draw landmarks if found
            if results.multi_hand_landmarks:
                for hand_landmarks in results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                    
                    if collecting:
                        # Only save one hand to keep rows consistent
                        save_landmarks(word, results.multi_hand_landmarks[0].landmark)
                        sample_count += 1
                        # Wait an extra tiny bit if we want a slower collection, or just let it fly
                        # 30fps = ~6.6 seconds for 200 frames
                        
            # Display current status on screen
            cv2.putText(frame, f"Word: {word}", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 0), 2)
            if collecting:
                cv2.putText(frame, f"Collecting: {sample_count}/{SAMPLES_PER_WORD}", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            else:
                cv2.putText(frame, "Press 'S' to Start", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                
            cv2.imshow('Data Collection', frame)

            key = cv2.waitKey(1)
            
            if key == ord('q'):
                print("Quitting data collection midway.")
                cap.release()
                cv2.destroyAllWindows()
                return
            
            if key == ord('s') and not collecting:
                print(f"Started collecting samples for '{word}'...")
                collecting = True
                
            if sample_count >= SAMPLES_PER_WORD:
                print(f"✅ Successfully collected {SAMPLES_PER_WORD} samples for '{word}'.\n")
                break # Move to the next word

    print("🎉 All words have been successfully trained!")
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        cam_id = sys.argv[1]
    else:
        cam_id = 0
        print("Usage: python collect_data.py [camera_id]")
        print("Defaulting to camera_id: 0")
        
    run(cam_id)
