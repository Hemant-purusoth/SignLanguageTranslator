import os
import cv2
import mediapipe as mp
import numpy as np
import time
import sys

# Setup MediaPipe
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
# static_image_mode=False is important here so it tracks hands continuously across frames
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=1, min_detection_confidence=0.5)

# Path for exported data, numpy arrays
DATA_PATH = os.path.join(os.path.dirname(__file__), 'MP_Data') 

# Actions that we try to detect (Dynamic Words)
actions = np.array(["iloveyou","monday"])

# Thirty sequences (videos) per word
no_sequences = 30

# Each sequence will have exactly 30 frames
sequence_length = 30

def setup_actions():
    """Checks if folders exist and asks the user whether to skip or overwrite."""
    actions_to_record = []
    
    for action in actions:
        action_path = os.path.join(DATA_PATH, action)
        
        if os.path.exists(action_path):
            print(f"\n⚠️  Data for '{action}' already exists.")
            choice = input(f"Do you want to (S)kip or (O)verwrite? [S/o]: ").strip().lower()
            
            if choice == 'o':
                print(f"🔄 Overwriting data for '{action}'...")
                # We don't delete the folder, we just let the new files overwrite the old ones
                actions_to_record.append(action)
            else:
                print(f"⏭️  Skipping '{action}'.")
        else:
            actions_to_record.append(action)
            
    # Create the necessary folders for the actions we ARE recording
    for action in actions_to_record:
        for sequence in range(no_sequences):
            try: 
                os.makedirs(os.path.join(DATA_PATH, action, str(sequence)))
            except FileExistsError:
                pass
                
    return actions_to_record

def extract_keypoints(results):
    """
    Extracts the x, y, z coordinates of all hand landmarks into a single 1D array.
    If no hand is detected, returns an array of zeros.
    """
    if results.multi_hand_landmarks:
        # Take the first hand detected
        hand = results.multi_hand_landmarks[0]
        # Flatten the list of [x, y, z] for each landmark
        # 21 landmarks * 3 coords = 63 values total
        return np.array([[res.x, res.y, res.z] for res in hand.landmark]).flatten()
    else:
        # If no hand in the frame, return an array of zeros
        return np.zeros(21*3)

def run(camera_id=0):
    actions_to_record = setup_actions()
    
    if not actions_to_record:
        print("\nNo actions selected for recording. Exiting.")
        return
        
    cap = cv2.VideoCapture(int(camera_id))
    
    print("\n🎥 Starting Sequence Data Collection Protocol...")
    print(f"Recording actions: {', '.join(actions_to_record)}")
    print("Each sequence consists of 30 frames (about 1 second of motion).")
    print("There will be a 2-second pause before each sequence starts so you can get ready.")
    print("Press 'Q' at any time to quit.")
    print("===================================================================\n")
    
    # Calculate how long each frame should take to ensure 30 frames = 2 seconds
    target_fps = sequence_length / 2.0  # 15 fps
    frame_delay = 1.0 / target_fps
    
    # Loop through actions we decided to record
    for action in actions_to_record:
        # Loop through sequences (akin to videos)
        for sequence in range(no_sequences):
            
            # --- 2 SECOND PAUSE BEFORE SEQUENCE ---
            # We must actively read frames during the pause to flush the camera buffer
            start_pause = time.time()
            while time.time() - start_pause < 2.0:
                ret, frame = cap.read()
                if ret:
                    frame = cv2.flip(frame, 1)
                    cv2.putText(frame, 'GET READY...', (120, 200), 
                               cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 255, 0), 4, cv2.LINE_AA)
                    cv2.putText(frame, f'Sequence {sequence} for {action} starting in 2s', (15, 30), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2, cv2.LINE_AA)
                    cv2.imshow('Sequence Data Collection', frame)
                    cv2.waitKey(1)
            
            # --- 2 SECOND COLLECTION (30 FRAMES) ---
            for frame_num in range(sequence_length):
                start_time = time.time()
                
                # Read feed
                ret, frame = cap.read()
                if not ret:
                    break
                    
                frame = cv2.flip(frame, 1) # Mirror

                # Processing the image with MediaPipe
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = hands.process(frame_rgb)
                
                # Draw landmarks to visualize what is being captured
                if results.multi_hand_landmarks:
                    for hand_landmarks in results.multi_hand_landmarks:
                        mp_drawing.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                
                # Display messages
                cv2.putText(frame, 'RECORDING', (120, 200), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 4, cv2.LINE_AA)
                cv2.putText(frame, f'Recording {action} | Seq {sequence} | Frame {frame_num}', (15,30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2, cv2.LINE_AA)
                cv2.imshow('Sequence Data Collection', frame)
                
                # Export keypoints to numpy arrays
                keypoints = extract_keypoints(results)
                npy_path = os.path.join(DATA_PATH, action, str(sequence), str(frame_num))
                np.save(npy_path, keypoints)

                # --- PACE THE LOOP TO EXACTLY 2 SECONDS TOTAL ---
                process_time = time.time() - start_time
                time_to_wait = max(0.0, frame_delay - process_time)
                
                # Wait dynamically to maintain 15fps, or break if Q is pressed
                if cv2.waitKey(int(time_to_wait * 1000) or 1) & 0xFF == ord('q'):
                    print("Quitting data collection midway.")
                    cap.release()
                    cv2.destroyAllWindows()
                    return
                    
    print("\n🎉 All sequential data collected successfully!")
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        cam_id = int(sys.argv[1])
    else:
        cam_id = 0
    run(cam_id)
