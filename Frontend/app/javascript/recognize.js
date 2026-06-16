window.addEventListener("DOMContentLoaded", () => {

  const searchInput = document.getElementById("searchInput");
  const referenceImage = document.getElementById("referenceImage");
  const wordBankContainer = document.getElementById("wordBankContainer");
  const startBtn = document.getElementById("startPracticeBtn");
  const endBtn = document.getElementById("endPracticeBtn");
  const outputBox = document.getElementById("outputBox");
  const video = document.getElementById("practiceCamera");
  const selectedWordDisplay = document.getElementById("selectedWordDisplay");

  let datasetWords = [];
  let selectedWord = "";
  let selectedWordType = "";
  let practiceScores = [];
  let isPracticing = false;

  // ==============================
  // LOAD DATASET
  // ==============================
  Promise.all([
    fetch("data/dataset.json").then(res => res.json()),
    fetch("data/user_dataset.json").then(res => res.json()).catch(() => ({ words: [] }))
  ])
    .then(([coreData, userData]) => {
      datasetWords = [...coreData.words, ...userData.words];
      console.log(`✅ Loaded ${datasetWords.length} total gestures (Core: ${coreData.words.length}, Custom: ${userData.words.length})`);
      renderWordBank(datasetWords);
    })
    .catch(err => console.error("❌ Dataset error:", err));

  // ==============================
  // BACKEND CONNECTION (Socket.IO)
  // ==============================
  const socket = io('http://localhost:5000');

  socket.on('connect', () => {
    console.log('✅ Connected to Python Backend');
  });

  socket.on('prediction', (data) => {
    if (!isPracticing || !selectedWord) return;

    if (data.label.toUpperCase() === selectedWord.toUpperCase()) {
      const similarity = (data.confidence * 100).toFixed(2);
      practiceScores.push(parseFloat(similarity));

      if (similarity > 80) {
        outputBox.innerHTML =
          `<div>Similarity: ${similarity}% <br> ✅ Excellent!</div>`;
      } else if (similarity > 50) {
        outputBox.innerHTML =
          `<div>Similarity: ${similarity}% <br> ⚠ Adjust your hand</div>`;
      } else {
        outputBox.innerHTML =
          `<div>Similarity: ${similarity}% <br> ❌ Try again</div>`;
      }
    } else {
      // We received a different label
      outputBox.innerHTML = `<div>Detected: ${data.label} <br> ❌ Match the selected word</div>`;
    }
  });


  // ==============================
  // WORD BANK & SEARCH FILTERING
  // ==============================
  function renderWordBank(wordsToRender) {
    wordBankContainer.innerHTML = "";
    wordsToRender.forEach(word => {
      const chip = document.createElement("div");
      chip.className = `sign-card ${selectedWord === word.label ? "active" : ""}`;
      chip.innerHTML = `<i class="fas fa-hand-sparkles" style="opacity: 0.5; margin-bottom: 8px; display: block; font-size: 1.2rem;"></i>${word.label}`;
      chip.onclick = () => selectWord(word);
      wordBankContainer.appendChild(chip);
    });
  }

  function selectWord(wordObj) {
    selectedWord = wordObj.label;
    selectedWordType = wordObj.type || "dynamic";
    referenceImage.src = wordObj.image && wordObj.image !== "" ? wordObj.image : "";
    referenceImage.style.display = wordObj.image && wordObj.image !== "" ? "block" : "none";
    selectedWordDisplay.innerText = selectedWord;
    
    // Refresh UI to show the 'active' highlight ring
    renderWordBank(datasetWords);
  }

  // Live filter feature for when the user gets 100+ words
  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    const filtered = datasetWords.filter(word => word.label.toLowerCase().includes(term));
    renderWordBank(filtered);
  });

  // ==============================
  // MEDIAPIPE INITIALIZATION
  // ==============================
  // Assuming MediaPipe scripts are loaded in the HTML
  const hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  // What to do when MediaPipe finds a hand
  hands.onResults((results) => {
    if (!isPracticing) return;

    // We only send data if a hand is detected
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const hand = results.multiHandLandmarks[0];

      // Extract 63 coordinates into a flat array
      const keypoints = [];
      for (let i = 0; i < hand.length; i++) {
        keypoints.push(hand[i].x);
        keypoints.push(hand[i].y);
        keypoints.push(hand[i].z);
      }

      // Send the tiny array to Python over websocket
      socket.emit('video_frame', keypoints);
    } else {
      // Send an array of 63 zeros if no hand is found (matches Python logic)
      const empty = new Array(63).fill(0);
      socket.emit('video_frame', empty);
    }
  });

  // Camera utility from MediaPipe
  let camera = null;

  // ==============================
  // START PRACTICE
  // ==============================
  startBtn.addEventListener("click", () => {

    if (!selectedWord) {
      alert("Please search and select a valid word first.");
      return;
    }

    practiceScores = [];
    isPracticing = true;
    startBtn.style.display = "none";
    endBtn.style.display = "inline-block";
    outputBox.innerText = "Processing camera feed...";

    // Tell backend which AI model to use and to reset its memory buffer
    socket.emit('set_mode', { type: selectedWordType });

    let lastFrameTime = 0;
    const fpsInterval = 1000 / 15; // Limit to 15 FPS to match training data exactly

    if (!camera) {
      camera = new Camera(video, {
        onFrame: async () => {
          if (!isPracticing) return;

          const now = Date.now();
          if (now - lastFrameTime >= fpsInterval) {
            lastFrameTime = now;
            await hands.send({ image: video });
          }
        },
        width: 640,
        height: 480
      });
    }

    // Start the camera processing loop
    camera.start();
  });

  // ==============================
  // END PRACTICE
  // ==============================
  endBtn.addEventListener("click", () => {
    isPracticing = false;

    // Tell backend to drop the memory buffer
    socket.emit('clear_sequence');

    // Stop the camera
    if (camera) {
      camera.stop();
    }

    // Hide End button, Show Start button
    endBtn.style.display = "none";
    startBtn.style.display = "inline-block";

    // Calculate Final Score
    if (practiceScores.length === 0) {
      outputBox.innerHTML = "<div><strong>Practice Ended!</strong><br>No gestures were recognized.</div>";
    } else {
      const avgScore = practiceScores.reduce((a, b) => a + b, 0) / practiceScores.length;
      outputBox.innerHTML = `<div><strong>Practice Ended!</strong><br>Final Average Match: ${avgScore.toFixed(2)}%</div>`;
    }
  });

});
