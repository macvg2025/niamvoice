// Room State
let localStream = null;
let isMuted = false;
let isSpeaking = false;
let roomCode = '';
let participants = new Map(); // participantId -> {name, isSpeaking, isMuted, audioElement}
let localParticipantId = generateId();
let audioContext = null;
let analyser = null;
let speakingThreshold = -45; // dB threshold for speech

// WebRTC Configuration
const SIGNALING_SERVER = 'https://niamvoice-signaling.onrender.com'; // Change to your Render URL
let signalingSocket = null;
let peerConnections = new Map(); // peerId -> RTCPeerConnection

// DOM Elements
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const muteToggleBtn = document.getElementById('muteToggleBtn');
const localMicCircle = document.getElementById('localMicCircle');
const micStatusText = document.getElementById('micStatusText');
const participantsList = document.getElementById('participantsList');
const participantCount = document.getElementById('participantCount');
const audioDeviceSelect = document.getElementById('audioDeviceSelect');
const connectionStatus = document.getElementById('connectionStatus');
const errorModal = document.getElementById('errorModal');
const errorTitle = document.getElementById('errorTitle');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const goHomeBtn = document.getElementById('goHomeBtn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Generate unique ID
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Format room code with dash
function formatRoomCode(code) {
    if (code.length === 6) {
        return `${code.substring(0, 3)}-${code.substring(3)}`;
    }
    return code;
}

// Get room code from URL
function getRoomCodeFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    let code = urlParams.get('room') || 'ABC123';
    
    if (code.length === 6) {
        return formatRoomCode(code);
    }
    
    return code;
}

// Show toast message
function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Show error modal
function showError(title, message) {
    errorTitle.textContent = title;
    errorMessage.textContent = message;
    errorModal.classList.add('active');
}

// Hide error modal
function hideError() {
    errorModal.classList.remove('active');
}

// Update participant list UI
function updateParticipantsUI() {
    participantsList.innerHTML = '';
    let count = 0;
    
    // Add local participant (you)
    const localParticipant = participants.get(localParticipantId);
    if (localParticipant) {
        addParticipantToUI(localParticipantId, localParticipant, true);
        count++;
    }
    
    // Add remote participants
    participants.forEach((participant, id) => {
        if (id !== localParticipantId) {
            addParticipantToUI(id, participant, false);
            count++;
        }
    });
    
    participantCount.textContent = count;
}

// Add participant to UI
function addParticipantToUI(id, participant, isLocal) {
    const participantEl = document.createElement('div');
    participantEl.className = `participant ${isLocal ? 'you' : ''} ${participant.isSpeaking ? 'speaking' : ''}`;
    participantEl.id = `participant-${id}`;
    
    // Generate avatar color based on name
    const colors = ['#3a86ff', '#8338ec', '#ff006e', '#ffbe0b', '#38b000'];
    const colorIndex = id.charCodeAt(0) % colors.length;
    
    participantEl.innerHTML = `
        <div class="avatar" style="background: ${colors[colorIndex]}">
            ${participant.name.charAt(0).toUpperCase()}
        </div>
        <div class="participant-info">
            <div class="participant-name">
                ${participant.name} ${isLocal ? '(You)' : ''}
            </div>
            <div class="participant-status">
                ${participant.isSpeaking ? '<i class="fas fa-volume-up"></i> Speaking' : ''}
                ${participant.isMuted ? '<i class="fas fa-microphone-slash"></i> Muted' : ''}
            </div>
        </div>
    `;
    
    participantsList.appendChild(participantEl);
}

// Update participant in UI
function updateParticipantUI(id) {
    const participant = participants.get(id);
    const participantEl = document.getElementById(`participant-${id}`);
    
    if (participantEl && participant) {
        participantEl.className = `participant ${id === localParticipantId ? 'you' : ''} ${participant.isSpeaking ? 'speaking' : ''}`;
        
        const statusEl = participantEl.querySelector('.participant-status');
        if (statusEl) {
            statusEl.innerHTML = participant.isSpeaking ? 
                '<i class="fas fa-volume-up"></i> Speaking' : 
                participant.isMuted ? '<i class="fas fa-microphone-slash"></i> Muted' : '';
        }
    }
}

// Update mute button UI
function updateMuteButton() {
    if (isMuted) {
        muteToggleBtn.className = 'mute-btn muted';
        muteToggleBtn.innerHTML = '<i class="fas fa-microphone-slash"></i><span>UNMUTE</span>';
        localMicCircle.classList.add('muted');
        localMicCircle.classList.remove('speaking');
        micStatusText.textContent = 'Your mic is OFF';
    } else {
        muteToggleBtn.className = 'mute-btn unmuted';
        muteToggleBtn.innerHTML = '<i class="fas fa-microphone"></i><span>MUTE</span>';
        localMicCircle.classList.remove('muted');
        micStatusText.textContent = 'Your mic is ON';
    }
}

// Update mic circle based on speaking state
function updateMicCircle() {
    if (isMuted) {
        localMicCircle.classList.add('muted');
        localMicCircle.classList.remove('speaking');
    } else if (isSpeaking) {
        localMicCircle.classList.add('speaking');
        localMicCircle.classList.remove('muted');
    } else {
        localMicCircle.classList.remove('speaking', 'muted');
    }
}

// Initialize microphone
async function initMicrophone() {
    try {
        // Request microphone permission
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        
        console.log('Microphone access granted');
        return true;
    } catch (error) {
        console.error('Error accessing microphone:', error);
        showError('Microphone Error', 
            error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' ?
            'Please allow microphone access to use voice chat.' :
            'Could not access microphone. Please check your audio settings.'
        );
        return false;
    }
}

// Setup audio analysis for voice detection
function setupAudioAnalysis() {
    if (!localStream || !window.AudioContext) return;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        
        const source = audioContext.createMediaStreamSource(localStream);
        source.connect(analyser);
        
        // Start checking for speech
        checkSpeakingLevel();
    } catch (error) {
        console.warn('Audio analysis not supported:', error);
    }
}

// Check if user is speaking
function checkSpeakingLevel() {
    if (!analyser) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    
    // Convert to dB (simplified)
    const dB = 20 * Math.log10(average / 255);
    
    // Update speaking state
    const wasSpeaking = isSpeaking;
    isSpeaking = !isMuted && dB > speakingThreshold;
    
    if (isSpeaking !== wasSpeaking) {
        // Update local participant
        const localParticipant = participants.get(localParticipantId);
        if (localParticipant) {
            localParticipant.isSpeaking = isSpeaking;
            updateParticipantUI(localParticipantId);
            updateMicCircle();
            
            // Broadcast speaking state to others
            if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
                signalingSocket.send(JSON.stringify({
                    type: 'speaking',
                    roomId: roomCode.replace('-', ''),
                    peerId: localParticipantId,
                    value: isSpeaking
                }));
            }
        }
    }
    
    // Continue checking
    requestAnimationFrame(checkSpeakingLevel);
}

// Populate audio device selector
async function populateAudioDevices() {
    try {
        // Wait for permission if needed
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        audioDeviceSelect.innerHTML = '<option value="">Select microphone...</option>';
        
        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Microphone ${audioDeviceSelect.length}`;
            audioDeviceSelect.appendChild(option);
        });
    } catch (error) {
        console.warn('Could not enumerate audio devices:', error);
    }
}

// Change audio device
async function changeAudioDevice(deviceId) {
    if (!deviceId) return;
    
    try {
        // Stop current stream
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        // Get new stream with selected device
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Update all existing peer connections
        peerConnections.forEach((pc, peerId) => {
            const senders = pc.getSenders();
            const audioSender = senders.find(sender => sender.track && sender.track.kind === 'audio');
            if (audioSender && localStream.getAudioTracks().length > 0) {
                audioSender.replaceTrack(localStream.getAudioTracks()[0]);
            }
        });
        
        // Restart audio analysis
        if (audioContext) {
            audioContext.close();
            audioContext = null;
            analyser = null;
        }
        
        setupAudioAnalysis();
        
        showToast('Microphone changed');
    } catch (error) {
        console.error('Error changing audio device:', error);
        showToast('Failed to change microphone');
    }
}

// Toggle mute
function toggleMute() {
    if (!localStream) return;
    
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    // Update local participant
    const localParticipant = participants.get(localParticipantId);
    if (localParticipant) {
        localParticipant.isMuted = isMuted;
        updateParticipantUI(localParticipantId);
    }
    
    updateMuteButton();
    updateMicCircle();
    
    // Broadcast mute state to others
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify({
            type: 'mute',
            roomId: roomCode.replace('-', ''),
            peerId: localParticipantId,
            value: isMuted
        }));
    }
}

// Copy room link to clipboard
function copyRoomLink() {
    const url = `${window.location.origin}${window.location.pathname.replace('index.html', 'room.html')}?room=${roomCode.replace('-', '')}`;
    
    navigator.clipboard.writeText(url).then(() => {
        showToast('Room link copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('Link copied!');
    });
}

// ==================== WEBRTC FUNCTIONS ====================

// Initialize WebRTC signaling connection
function initSignaling() {
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.close();
    }
    
    signalingSocket = new WebSocket(SIGNALING_SERVER);
    
    signalingSocket.onopen = () => {
        console.log('✅ Connected to signaling server');
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Connected';
        
        // Join the room
        signalingSocket.send(JSON.stringify({
            type: 'join',
            roomId: roomCode.replace('-', ''),
            peerId: localParticipantId
        }));
    };
    
    signalingSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📨 Signal:', data.type);
            
            switch (data.type) {
                case 'peers':
                    // Connect to existing peers in room
                    data.peers.forEach(peerId => {
                        if (peerId !== localParticipantId && !peerConnections.has(peerId)) {
                            createPeerConnection(peerId);
                        }
                    });
                    break;
                    
                case 'new-peer':
                    // New peer joined the room
                    if (data.peerId !== localParticipantId && !peerConnections.has(data.peerId)) {
                        createPeerConnection(data.peerId);
                    }
                    break;
                    
                case 'signal':
                    // Handle WebRTC signaling message
                    handleSignal(data.from, data.signal);
                    break;
                    
                case 'peer-left':
                    // Peer disconnected
                    removePeerConnection(data.peerId);
                    break;
                    
                case 'mute':
                    // Update peer's mute status
                    updatePeerMute(data.peerId, data.value);
                    break;
                    
                case 'speaking':
                    // Update peer's speaking status
                    updatePeerSpeaking(data.peerId, data.value);
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    };
    
    signalingSocket.onclose = () => {
        console.log('❌ Disconnected from signaling server');
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Reconnecting...';
        
        // Try to reconnect after 3 seconds
        setTimeout(initSignaling, 3000);
    };
    
    signalingSocket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Create a WebRTC connection with another peer
function createPeerConnection(peerId) {
    console.log(`Creating connection with ${peerId}`);
    
    // Create RTCPeerConnection
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });
    
    peerConnections.set(peerId, pc);
    
    // Add local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle incoming track (audio from remote peer)
    pc.ontrack = (event) => {
        console.log(`Received audio track from ${peerId}`);
        
        // Create audio element for remote stream
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.volume = 1.0;
        
        // Add to participants
        if (!participants.has(peerId)) {
            participants.set(peerId, {
                name: `User${peerId.substring(0, 4)}`,
                isSpeaking: false,
                isMuted: false,
                audioElement: audio
            });
            updateParticipantsUI();
        } else {
            participants.get(peerId).audioElement = audio;
        }
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate && signalingSocket.readyState === WebSocket.OPEN) {
            signalingSocket.send(JSON.stringify({
                type: 'signal',
                roomId: roomCode.replace('-', ''),
                from: localParticipantId,
                to: peerId,
                signal: {
                    type: 'candidate',
                    candidate: event.candidate
                }
            }));
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE state for ${peerId}: ${pc.iceConnectionState}`);
        
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            // Try to restart ICE
            setTimeout(() => {
                if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'checking') {
                    pc.restartIce();
                }
            }, 1000);
        }
    };
    
    // If we're initiating the connection, create an offer
    if (peerId > localParticipantId) { // Simple way to decide who initiates
        createOffer(peerId, pc);
    }
}

// Create WebRTC offer
async function createOffer(peerId, pc) {
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        signalingSocket.send(JSON.stringify({
            type: 'signal',
            roomId: roomCode.replace('-', ''),
            from: localParticipantId,
            to: peerId,
            signal: {
                type: 'offer',
                sdp: offer.sdp
            }
        }));
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

// Handle incoming WebRTC signals
async function handleSignal(from, signal) {
    const pc = peerConnections.get(from);
    if (!pc) {
        console.log(`No connection found for ${from}, creating one...`);
        createPeerConnection(from);
        return;
    }
    
    try {
        if (signal.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            signalingSocket.send(JSON.stringify({
                type: 'signal',
                roomId: roomCode.replace('-', ''),
                from: localParticipantId,
                to: from,
                signal: {
                    type: 'answer',
                    sdp: answer.sdp
                }
            }));
        } else if (signal.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.type === 'candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    } catch (error) {
        console.error('Error handling signal:', error);
    }
}

// Remove peer connection
function removePeerConnection(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
        pc.close();
        peerConnections.delete(peerId);
    }
    
    // Remove from participants
    if (participants.has(peerId)) {
        const participant = participants.get(peerId);
        if (participant.audioElement) {
            participant.audioElement.pause();
            participant.audioElement.srcObject = null;
        }
        participants.delete(peerId);
        updateParticipantsUI();
    }
}

// Update peer's mute status
function updatePeerMute(peerId, isMuted) {
    const participant = participants.get(peerId);
    if (participant) {
        participant.isMuted = isMuted;
        updateParticipantUI(peerId);
    }
}

// Update peer's speaking status
function updatePeerSpeaking(peerId, isSpeaking) {
    const participant = participants.get(peerId);
    if (participant) {
        participant.isSpeaking = isSpeaking;
        updateParticipantUI(peerId);
    }
}

// ==================== ROOM INITIALIZATION ====================

// Initialize room
async function initRoom() {
    roomCode = getRoomCodeFromURL();
    roomCodeDisplay.textContent = roomCode;
    document.title = `Room ${roomCode} - VoiceChat.audio`;
    
    // Add local participant
    participants.set(localParticipantId, {
        name: 'You',
        isSpeaking: false,
        isMuted: false,
        audioElement: null
    });
    
    updateParticipantsUI();
    
    // Try to get microphone access
    const micSuccess = await initMicrophone();
    if (micSuccess) {
        setupAudioAnalysis();
        populateAudioDevices();
        updateMuteButton();
        
        // Initialize signaling connection
        initSignaling();
    }
}

// ==================== EVENT LISTENERS ====================

copyLinkBtn.addEventListener('click', copyRoomLink);

leaveRoomBtn.addEventListener('click', () => {
    if (confirm('Leave this voice room?')) {
        // Send leave message
        if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
            signalingSocket.send(JSON.stringify({
                type: 'leave',
                roomId: roomCode.replace('-', ''),
                peerId: localParticipantId
            }));
            signalingSocket.close();
        }
        
        // Close all peer connections
        peerConnections.forEach((pc, peerId) => {
            pc.close();
        });
        
        // Stop local stream
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        // Redirect to home
        window.location.href = 'index.html';
    }
});

muteToggleBtn.addEventListener('click', toggleMute);

localMicCircle.addEventListener('click', toggleMute);

audioDeviceSelect.addEventListener('change', (e) => {
    changeAudioDevice(e.target.value);
});

retryBtn.addEventListener('click', () => {
    hideError();
    initRoom();
});

goHomeBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleMute();
    }
    
    if (e.code === 'KeyL' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        copyRoomLink();
    }
    
    if (e.code === 'Escape') {
        if (errorModal.classList.contains('active')) {
            hideError();
        }
    }
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    initRoom();
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    // Send leave message
    if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        signalingSocket.send(JSON.stringify({
            type: 'leave',
            roomId: roomCode.replace('-', ''),
            peerId: localParticipantId
        }));
    }
    
    // Close all connections
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    if (audioContext) {
        audioContext.close();
    }
    
    peerConnections.forEach(pc => pc.close());
});
