document.addEventListener("DOMContentLoaded", async () => {
    const gestureLabelInput = document.getElementById("gestureLabel");
    const gestureTypeSelect = document.getElementById("gestureType");
    const checkBtn = document.getElementById("checkBtn");
    const recordBtn = document.getElementById("recordBtn");
    const statusMessage = document.getElementById("statusMessage");
    const progressText = document.getElementById("progressText");
    const cameraOverlay = document.getElementById("cameraOverlay");
    const video = document.getElementById("trainCamera");
    const userGesturesTable = document.getElementById("userGesturesTable");
    const trainAllBtn = document.getElementById("trainAllBtn");

    let coreDataset = [];
    let userDataset = [];
    let isRecording = false;
    let currentAction = "";
    let currentType = "";
    let framesCollected = 0;
    let targetFrames = 0;
    let sequenceCount = 0;
    let targetSequences = 0;

    // Socket Connection
    const socket = io();


    // Load datasets dynamically
    async function loadDatasets() {
        try {
            const coreRes = await fetch("data/dataset.json");
            const coreData = await coreRes.json();
            coreDataset = coreData.words;

            const userRes = await fetch("data/user_dataset.json");
            const userData = await userRes.json();
            userDataset = userData.words;

            renderDashboard();
        } catch (err) {
            console.error("Error loading datasets", err);
        }
    }

    // Initial Load
    await loadDatasets();

    // Show status helper
    function showStatus(msg, color) {
        statusMessage.style.color = color;
        statusMessage.style.border = `1px solid ${color}`;
        statusMessage.innerText = msg;
    }

    // Check Availability Logic
    checkBtn.addEventListener("click", () => {
        const word = gestureLabelInput.value.trim().toLowerCase();

        if (!word) {
            showStatus("Please enter a gesture name.", "var(--danger-color)");
            recordBtn.style.display = "none";
            return;
        }

        // Check core dataset
        const inCore = coreDataset.some(d => d.label.toLowerCase() === word);
        if (inCore) {
            showStatus(`❌ "${word}" is a core system gesture and cannot be overwritten.`, "var(--danger-color)");
            recordBtn.style.display = "none";
            return;
        }

        // Check user dataset
        const inUser = userDataset.some(d => d.label.toLowerCase() === word);
        if (inUser) {
            showStatus(`❌ You have already trained "${word}". Delete it from the dashboard first to retrain.`, "var(--danger-color)");
            recordBtn.style.display = "none";
            return;
        }

        // Approved
        currentAction = word;
        currentType = gestureTypeSelect.value;
        showStatus(`✅ "${word}" is available! Click Start Recording.`, "var(--success-color)");
        recordBtn.style.display = "inline-block";
    });

    // Load MediaPipe
    const hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    let lastFrameTime = 0;
    const fpsInterval = 1000 / 15; // Limit to 15 FPS to match sequence timing exactly

    hands.onResults((results) => {
        if (!isRecording) return;

        let keypoints = [];
        let handDetected = false;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            handDetected = true;
            const hand = results.multiHandLandmarks[0];

            if (currentType === "static") {
                // Static needs only X, Y (42 values)
                for (let i = 0; i < hand.length; i++) {
                    keypoints.push(hand[i].x);
                    keypoints.push(hand[i].y);
                }
            } else {
                // Dynamic needs X, Y, Z (63 values)
                for (let i = 0; i < hand.length; i++) {
                    keypoints.push(hand[i].x);
                    keypoints.push(hand[i].y);
                    keypoints.push(hand[i].z);
                }
            }
        }

        // Handle missing frames!
        if (currentType === "static") {
            // Static mode strictly awaits a visible hand
            if (!handDetected) return;
        } else {
            // Dynamic mode timeline must march forward even if tracking is temporarily lost
            if (!handDetected) {
                keypoints = new Array(63).fill(0);
            }
        }

        // Send the frame data to Python to save
        socket.emit('collect_frame', {
            action: currentAction,
            type: currentType,
            sequence: sequenceCount,
            frame: framesCollected,
            data: keypoints
        });

        framesCollected++;
        updateProgressUI();
    });

    let camera = null;

    // Display Table Logic
    function renderDashboard() {
        userGesturesTable.innerHTML = "";
        if (userDataset.length === 0) {
            userGesturesTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">No custom gestures recorded yet.</td></tr>`;
            return;
        }

        userDataset.forEach((gesture) => {
            const row = document.createElement("tr");
            row.innerHTML = `
        <td style="padding: 15px; font-weight: bold;">${gesture.label}</td>
        <td style="padding: 15px; text-transform: capitalize;">${gesture.type}</td>
        <td style="padding: 15px;"><span style="color: var(--success-color);"><i class="fas fa-check-circle"></i> Recorded</span></td>
        <td style="padding: 15px;">
          <button class="delete-btn" data-label="${gesture.label}" style="background: transparent; border: none; color: var(--danger-color); cursor: pointer; font-size: 1.2rem;">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
            userGesturesTable.appendChild(row);
        });

        // Attach delete listeners
        document.querySelectorAll(".delete-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const title = e.currentTarget.getAttribute("data-label");
                if (confirm(`Are you sure you want to delete the gesture '${title}'? This cannot be undone.`)) {
                    socket.emit("delete_gesture", { label: title });
                    // Optimistic UI update
                    userDataset = userDataset.filter(d => d.label !== title);
                    renderDashboard();
                }
            });
        });
    }

    // ----------------------------------------------------------------------
    // COLLECTION LOOP RECORDING LOGIC
    // ----------------------------------------------------------------------

    function updateProgressUI() {
        if (currentType === "static") {
            progressText.innerText = `Collecting Static Images: ${framesCollected} / ${targetFrames}`;
            if (framesCollected >= targetFrames) {
                finishRecording();
            }
        } else {
            progressText.innerText = `Sequence ${sequenceCount + 1}/${targetSequences} | Frame: ${framesCollected}/${targetFrames}`;
            if (framesCollected >= targetFrames) {
                sequenceCount++;
                framesCollected = 0; // reset frames for next sequence

                if (sequenceCount >= targetSequences) {
                    finishRecording();
                } else {
                    // Pause between sequences
                    pauseForNextSequence();
                }
            }
        }
    }

    function pauseForNextSequence() {
        isRecording = false;
        cameraOverlay.style.display = "flex";
        cameraOverlay.innerHTML = `<h2>GET READY<br>Sequence ${sequenceCount + 1} starting...</h2>`;

        setTimeout(() => {
            cameraOverlay.style.display = "none";
            isRecording = true;
            updateProgressUI();
        }, 2000); // 2 second pause
    }

    function finishRecording() {
        isRecording = false;

        // Stop the webcam once recording is finished
        if (camera) {
            camera.stop();
            camera = null;
        }

        showStatus(`🎉 Recording Complete for "${currentAction}"!`, "var(--success-color)");
        progressText.innerText = "Data Transmitted to Python Backend.";
        recordBtn.style.display = "none";

        // Tell python the gesture is fully collected so it can save to user_dataset.json
        socket.emit('recording_complete', {
            label: currentAction,
            type: currentType
        });

        // Add to local UI array immediately for snappy feel
        userDataset.push({ label: currentAction, type: currentType });
        renderDashboard();
    }

    recordBtn.addEventListener("click", () => {
        recordBtn.style.display = "none";
        checkBtn.style.display = "none";
        gestureLabelInput.disabled = true;
        gestureTypeSelect.disabled = true;

        // Start the camera ONLY when the record button is clicked
        if (!camera) {
            let lastFrameTime = 0;
            const fpsInterval = 1000 / 15; // Limit to 15 FPS to match sequence timing exactly

            camera = new Camera(video, {
                onFrame: async () => {
                    if (!isRecording) return;

                    const now = Date.now();
                    if (now - lastFrameTime >= fpsInterval) {
                        lastFrameTime = now;
                        await hands.send({ image: video });
                    }
                },
                width: 640,
                height: 480
            });
            camera.start();
        }

        if (currentType === "static") {
            targetFrames = 200;
            framesCollected = 0;
            isRecording = true;
            updateProgressUI();
        } else {
            targetSequences = 30;
            targetFrames = 30;
            sequenceCount = 0;
            framesCollected = 0;
            pauseForNextSequence(); // Starts recording after initial 2s pause
        }
    });

    trainAllBtn.addEventListener("click", () => {
        trainAllBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Training Models in Background...`;
        trainAllBtn.disabled = true;
        socket.emit('trigger_training');
    });

    socket.on('training_complete', () => {
        alert("✅ All Custom Models Successfully Trained and Saved!");
        trainAllBtn.innerHTML = `<i class="fas fa-brain"></i> Train Selected Models Now`;
        trainAllBtn.disabled = false;
    });

});
