import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score
import pickle

DATA_FILE = 'dataset.csv'
MODEL_FILE = 'model.p'

def train():
    print("⏳ Loading dataset...")
    try:
        df = pd.read_csv(DATA_FILE)
    except FileNotFoundError:
        print("❌ Dataset not found! Run collect_data.py first.")
        return

    # Check if we have enough data
    if len(df) < 10:
        print("⚠ Not enough data to train. Please collect more samples.")
        return

    # Separate features (landmarks) and labels
    X = df.drop('label', axis=1)
    y = df['label']

    # Split data
    x_train, x_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=True, stratify=y
    )

    # Initialize model
    model = RandomForestClassifier()

    print("🧠 Training model...")
    model.fit(x_train, y_train)

    # Test accuracy
    y_pred = model.predict(x_test)
    score = accuracy_score(y_test, y_pred)
    print(f"✅ Model trained! Accuracy: {score * 100:.2f}%")

    # Save model
    with open(MODEL_FILE, 'wb') as f:
        pickle.dump({'model': model}, f)

    print(f"💾 Model saved to '{MODEL_FILE}'")

if __name__ == "__main__":
    train()
