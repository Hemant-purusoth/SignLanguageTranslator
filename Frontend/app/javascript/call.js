// ==============================
// GLOBAL STATE & ELEMENTS
// ==============================
// Use the current host IP so it works across devices on the network
const socket = io(`http://${window.location.hostname}:5000`);

// Initialize State
userMode = null; // 'signer' or 'speaker'
roomId = '';
isCallActive = false;
isMuted = false;

// WebRTC State
let localStream;
let peerConnection;
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// ML & Speech State
let hands = null;
let camera = null;
let speechRecognition = null;
let sentenceBuffer = [];
let lastGestureTime = 0;
const SENTENCE_TIMEOUT_MS = 2500; // Clear sentence 2.5s after last word

// UI Elements
let lobbySection, callSection, modeSignerCard, modeSpeakerCard, roomIdInput, joinCallBtn, createRoomBtn, lobbyStatus;
let localVideo, remoteVideo, endCallBtn, muteBtn, statusMessage, localSubtitles, remoteSubtitles, previewText;

// Expose selectMode globally just in case
window.selectMode = function(mode) {
    userMode = mode;
    if (modeSignerCard) modeSignerCard.classList.remove('selected');
    if (modeSpeakerCard) modeSpeakerCard.classList.remove('selected');
    
    if (mode === 'signer') {
        if (modeSignerCard) modeSignerCard.classList.add('selected');
    } else {
        if (modeSpeakerCard) modeSpeakerCard.classList.add('selected');
    }
    
    if (joinCallBtn) joinCallBtn.disabled = false;
    if (createRoomBtn) createRoomBtn.disabled = false;
};

window.addEventListener('DOMContentLoaded', () => {
    // UI Elements: Lobby
    lobbySection = document.getElementById('lobbySection');
    callSection = document.getElementById('callSection');
    modeSignerCard = document.getElementById('modeSigner');
    modeSpeakerCard = document.getElementById('modeSpeaker');
    roomIdInput = document.getElementById('roomIdInput');
    joinCallBtn = document.getElementById('joinCallBtn');
    createRoomBtn = document.getElementById('createRoomBtn');
    lobbyStatus = document.getElementById('lobbyStatus');

    // UI Elements: Call
    localVideo = document.getElementById('localVideo');
    remoteVideo = document.getElementById('remoteVideo');
    endCallBtn = document.getElementById('endCallBtn');
    muteBtn = document.getElementById('muteBtn');
    statusMessage = document.getElementById('statusMessage');
    localSubtitles = document.getElementById('localSubtitles');
    remoteSubtitles = document.getElementById('remoteSubtitles');
    previewText = document.getElementById('previewText');

// ==============================
// 1. LOBBY LOGIC
// ==============================

modeSignerCard.addEventListener('click', () => selectMode('signer'));
modeSpeakerCard.addEventListener('click', () => selectMode('speaker'));

// Create generic start call function
async function startCallSequence(roomIdToJoin) {
    lobbyStatus.innerText = "Requesting device permissions...";
    joinCallBtn.disabled = true;
    createRoomBtn.disabled = true;

    try {
        const constraints = { video: true, audio: true };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        
        lobbySection.style.display = 'none';
        callSection.style.display = 'block';
        updateStatus(`Joining room: ${roomIdToJoin}...`);
        isCallActive = true;

        if (userMode === 'signer') {
            initSignerPipeline();
        } else {
            initSpeakerPipeline();
        }

        socket.emit('join-room', roomIdToJoin);
        
    } catch (err) {
        console.error('Error accessing media:', err);
        lobbyStatus.innerText = "Error accessing camera/microphone. Please check permissions.";
        joinCallBtn.disabled = false;
        createRoomBtn.disabled = false;
    }
}

joinCallBtn.addEventListener('click', () => {
    roomId = roomIdInput.value.trim().toUpperCase();
    if (!roomId) {
        lobbyStatus.innerText = "Please enter a Room Code to join.";
        return;
    }
    if (!userMode) return;
    
    startCallSequence(roomId);
});

createRoomBtn.addEventListener('click', () => {
    if (!userMode) return;
    // Generate random 6-character alphanumeric code
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    startCallSequence(roomId);
});

endCallBtn.addEventListener('click', hangUp);

muteBtn.addEventListener('click', () => {
    if (localStream) {
        // Toggle all audio tracks
        const audioTracks = localStream.getAudioTracks();
        isMuted = !isMuted;
        
        audioTracks.forEach(track => {
            track.enabled = !isMuted; // disabled = muted
        });
        
        if (isMuted) {
            muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i> Unmute';
            muteBtn.style.backgroundColor = 'var(--danger)';
            muteBtn.style.color = 'white';
        } else {
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i> Mute';
            muteBtn.style.backgroundColor = 'var(--primary-light)';
            muteBtn.style.color = 'var(--primary)';
        }
    }
});

// ==============================
// 2. WEBRTC SIGNALING
// ==============================

}); // End of DOMContentLoaded

socket.on('room-created', (room) => {
    updateStatus(`Room Created! Code: <strong>${room}</strong>`);
    // Copy to clipboard helper
    navigator.clipboard.writeText(room).catch(err => console.log('Copy failed', err));
});

socket.on('room-full', (room) => {
    alert(`Room ${room} is currently full. Only 2 users are allowed per room.`);
    hangUp();
});

socket.on('user-joined', async () => {
    updateStatus('User joined! Starting call...');
    createPeerConnection();

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('signal', {
            to: roomId,
            signal: { type: 'offer', sdp: offer }
        });
    } catch (err) {
        console.error('Error creating offer:', err);
    }
});

socket.on('signal', async (data) => {
    if (!data.signal) return;
    const signal = data.signal;

    if (signal.type === 'offer') {
        if (!peerConnection) createPeerConnection();

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('signal', {
            to: roomId,
            signal: { type: 'answer', sdp: answer }
        });
        updateStatus('Call connected!');
        
    } else if (signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        updateStatus('Call connected!');
        
    } else if (signal.candidate) {
        try {
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch (err) {
            console.error('Error adding ICE candidate', err);
        }
    }
});

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', {
                to: roomId,
                signal: { candidate: event.candidate }
            });
        }
    };

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'disconnected') {
            updateStatus('Remote user disconnected.');
            remoteVideo.srcObject = null;
        }
    };
}

// ==============================
// 3. PIPELINE: SIGNER (MediaPipe)
// ==============================

function initSignerPipeline() {
    previewText.innerText = "Initializing Gesture Tracking...";
    
    // Tell backend we are doing BOTH static and dynamic sign predictions
    socket.emit('set_mode', { type: "both" });

    hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    hands.onResults((results) => {
        if (!isCallActive) return;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const hand = results.multiHandLandmarks[0];
            const keypoints = [];
            for (let i = 0; i < hand.length; i++) {
                keypoints.push(hand[i].x, hand[i].y, hand[i].z);
            }
            socket.emit('video_frame', keypoints);
        } else {
            const empty = new Array(63).fill(0);
            socket.emit('video_frame', empty);
        }
    });

    // Start 15FPS processing loop
    let lastFrameTime = 0;
    const fpsInterval = 1000 / 15;
    
    camera = new Camera(localVideo, {
        onFrame: async () => {
            if (!isCallActive) return;
            const now = Date.now();
            if (now - lastFrameTime >= fpsInterval) {
                lastFrameTime = now;
                await hands.send({ image: localVideo });
            }
            
            // Handle Sentence Timeout
            if (sentenceBuffer.length > 0 && (now - lastGestureTime) > SENTENCE_TIMEOUT_MS) {
                commitSentence();
            }
        },
        width: 640,
        height: 480
    });
    
    camera.start();
    previewText.innerText = "Signing Mode Active";
}

// Listen for Predictions from Python Backend
socket.on('prediction', (data) => {
    if (userMode !== 'signer' || !isCallActive) return;
    
    if (data.confidence > 0.85) {
        // Simple Debounce: Don't add if it's the exact same word we just added
        const lastWord = sentenceBuffer.length > 0 ? sentenceBuffer[sentenceBuffer.length - 1] : "";
        if (lastWord !== data.label) {
            sentenceBuffer.push(data.label);
            lastGestureTime = Date.now();
            
            const currentSentence = sentenceBuffer.join(" ") + "...";
            localSubtitles.innerText = currentSentence;
            
            // Broadcast current draft sentence to remote user
            socket.emit('translation', { room: roomId, text: currentSentence, final: false });
        }
    }
});

function commitSentence() {
    const finalSentence = sentenceBuffer.join(" ");
    localSubtitles.innerText = finalSentence;
    // Broadcast final sentence
    socket.emit('translation', { room: roomId, text: finalSentence, final: true });
    
    // Clear buffer
    sentenceBuffer = [];
}


// ==============================
// 4. PIPELINE: SPEAKER (Web Speech API)
// ==============================

function initSpeakerPipeline() {
    previewText.innerText = "Initializing Speech Recognition...";
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Speech Recognition is not supported in this browser. Please use Chrome.");
        return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    let clearSubtitleTimeout;

    let lastResultTime = Date.now();
    let watchdogInterval;

    speechRecognition.onresult = (event) => {
        if (!isCallActive) return;
        lastResultTime = Date.now(); // Reset watchdog
        
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const displayText = finalTranscript || interimTranscript;
        
        if (displayText.trim().length > 0) {
            clearTimeout(clearSubtitleTimeout);
            localSubtitles.innerText = displayText;
            
            socket.emit('translation', { 
                room: roomId, 
                text: displayText, 
                final: !!finalTranscript 
            });
            
            if (finalTranscript) {
                clearSubtitleTimeout = setTimeout(() => { 
                    if (isCallActive) localSubtitles.innerText = "Listening..."; 
                }, 3500);
            }
        }
    };

    speechRecognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        if (event.error !== 'no-speech') {
            localSubtitles.innerText = `Mic Error: ${event.error}`;
        }
        // Force restart on error
        try { speechRecognition.stop(); } catch(e) {}
    };

    speechRecognition.onend = () => {
        if (isCallActive) {
            try { speechRecognition.start(); } catch(e) {}
        }
    };

    // Chrome Web Speech API bug: it silently dies after ~15s of silence
    // Watchdog timer: If no result for 10 seconds, force restart.
    watchdogInterval = setInterval(() => {
        if (isCallActive && (Date.now() - lastResultTime > 10000)) {
            lastResultTime = Date.now(); 
            try {
                speechRecognition.stop(); 
                // onend will catch this and restart it
            } catch(e) {}
        }
        if (!isCallActive) {
            clearInterval(watchdogInterval);
        }
    }, 5000);

    try {
        speechRecognition.start();
        previewText.innerText = "Speaking Mode Active. Microphone listening...";
    } catch(err) {
        localSubtitles.innerText = "Failed to start microphone listener.";
    }
}

// ==============================
// 5. RECEIVING SUBTITLES
// ==============================

socket.on('translation', (data) => {
    if (data.text) {
        remoteSubtitles.innerText = data.text;
        
        if (data.final) {
            // If it's a final sentence, leave it for a few seconds then clear
            setTimeout(() => {
                if (remoteSubtitles.innerText === data.text) {
                    remoteSubtitles.innerText = "Waiting for input...";
                }
            }, 3500);
        }
    }
});

// ==============================
// 6. UTILS
// ==============================

function hangUp() {
    isCallActive = false;
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (camera) {
        camera.stop();
    }
    if (speechRecognition) {
        speechRecognition.stop();
    }

    socket.disconnect();
    window.location.reload();
}

function updateStatus(msg) {
    statusMessage.innerHTML = `<i class="fas fa-info-circle"></i> ${msg}`;
}
