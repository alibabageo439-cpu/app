import { supabase } from './supabase.js';

const me = sessionStorage.getItem('chat_user');
if (!me) window.location.href = 'index.html';

const target = me === 'A' ? 'S' : 'A';
const chatId = 'A_S';

const msgContainer = document.getElementById('messages-container');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const voiceBtn = document.getElementById('voice-btn');
const targetStatus = document.getElementById('target-status');

// Helper for status timeout
let typingTimeout;
let recordingTimeout;
let isTypingLocal = false;
let isRecordingLocal = false;
let currentActivity = null; // 'typing', 'recording', or null

let mediaRecorder;
let audioChunks = [];
let recordingInterval;
let targetIsOnline = false;

async function init() {
    // Identity selection based on me/target
    const name = target === 'S' ? 'user_S' : 'user_A';
    document.getElementById('target-name').innerText = name;

    // Set profile icon initial
    const avatarEl = document.getElementById('target-avatar');
    if (avatarEl) {
        const dot = document.getElementById('online-dot');
        avatarEl.innerHTML = target; // Show A or S
        if (dot) avatarEl.appendChild(dot);
    }

    // Only user_A can change password
    const passBtn = document.getElementById('change-pass-btn');
    if (passBtn) {
        passBtn.style.display = me === 'A' ? 'flex' : 'none';
    }

    await loadMessages();
    await loadProfiles();
    setupSubscriptions();
    updatePresence(true);
}

// Global state for profiles
let profilePics = { A: null, S: null };

async function loadProfiles() {
    // We fetch the latest 'profile_pic' type message for each user to avoid schema errors
    const { data } = await supabase.from('messages')
        .select('sender, content, type')
        .eq('type', 'profile_pic')
        .order('created_at', { ascending: true }); // Get all, later ones overwrite

    if (data) {
        data.forEach(m => {
            profilePics[m.sender] = m.content;
        });
        updateProfileUI();
    }
}

function updateProfileUI() {
    const targetAvatar = document.getElementById('target-avatar');
    if (targetAvatar) {
        const dot = document.getElementById('online-dot');
        if (profilePics[target]) {
            targetAvatar.innerHTML = `<img src="${profilePics[target]}" alt="${target}">`;
            targetAvatar.onclick = (e) => {
                e.stopPropagation();
                openProfileViewer(target);
            };
        } else {
            targetAvatar.innerHTML = target;
            targetAvatar.onclick = null;
        }
        if (dot) targetAvatar.appendChild(dot);
    }
}

function openProfileViewer(user) {
    const modal = document.getElementById('profile-viewer-modal');
    const img = document.getElementById('profile-viewer-img');
    const name = document.getElementById('profile-viewer-name');
    if (modal && img && profilePics[user]) {
        img.src = profilePics[user];
        name.innerText = user === 'A' ? 'user_A' : 'user_S';
        modalOverlay.classList.add('active');
        modal.classList.add('active');
    }
}

async function loadMessages() {
    const { data } = await supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true });
    if (data) {
        msgContainer.innerHTML = '';
        data.forEach(msg => {
            if (msg.type === 'profile_pic') {
                profilePics[msg.sender] = msg.content;
            } else if (msg.type === 'calculator_password' || msg.type === 'user_a_password') {
                // Ignore these in UI
            } else {
                renderMessage(msg);
            }
        });
        updateProfileUI();
        scrollToBottom();
        markAsSeen();
    }
}

function renderMessage(msg) {
    if (document.getElementById(`msg-${msg.id}`)) return;

    const isMe = msg.sender === me;
    const div = document.createElement('div');
    div.className = `message-bubble ${isMe ? 'msg-me' : 'msg-them'}`;
    div.id = `msg-${msg.id}`;

    let contentHtml = '';
    if (msg.type === 'text') contentHtml = `<p>${msg.content}</p>`;
    else if (msg.type === 'image') contentHtml = `<img src="${msg.content}" class="chat-img" onclick="window.openImageViewer('${msg.content.replace(/'/g, "\\'")}')">`;
    else if (msg.type === 'video') contentHtml = `<video src="${msg.content}" controls class="chat-vid"></video>`;
    else if (msg.type === 'voice') contentHtml = `<audio src="${msg.content}" controls class="chat-audio"></audio>`;

    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '5:12 PM';

    let ticks = '';
    if (isMe) {
        if (msg.seen) {
            ticks = `<span class="ticks seen"><i class="fas fa-check-double"></i></span>`;
        } else if (targetIsOnline) {
            ticks = `<span class="ticks online-double"><i class="fas fa-angle-double-right"></i></span>`;
        } else {
            ticks = `<span class="ticks"><i class="fas fa-arrow-right"></i></span>`;
        }
    }

    div.innerHTML = `
        <div class="bubble-content">${contentHtml}</div>
        <div class="bubble-meta">
            <span class="msg-time">${time}</span>
            ${ticks}
        </div>
    `;
    msgContainer.appendChild(div);
    scrollToBottom();
}

async function sendMessage(type, content) {
    const { error } = await supabase.from('messages').insert([{
        chat_id: chatId, sender: me, receiver: target, type, content, seen: false
    }]);
    if (error) alert("Failed to send: " + error.message);
    else {
        msgInput.value = '';
        toggleBtn();
    }
}

// Presence Logic
let presenceChannel;
let presenceInterval;

async function updatePresence(online) {
    try {
        await supabase.from('users').upsert({
            name: me,
            online,
            last_seen: new Date().toISOString()
        });
    } catch (e) {
        console.error("Presence update failed:", e);
    }
}

function setupSubscriptions() {
    // 1. Message Updates
    supabase.channel('chat_realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            if (payload.new.chat_id === chatId) {
                if (payload.new.type === 'profile_pic') {
                    profilePics[payload.new.sender] = payload.new.content;
                    updateProfileUI();
                } else if (payload.new.type === 'calculator_password') {
                    localStorage.setItem('calc_password', payload.new.content);
                } else if (payload.new.type === 'user_a_password') {
                    localStorage.setItem('user_a_password', payload.new.content);
                } else {
                    renderMessage(payload.new);
                    if (payload.new.receiver === me) markAsSeen();
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
            const el = document.getElementById(`msg-${payload.new.id}`);
            if (el && payload.new.seen) {
                const tickEl = el.querySelector('.ticks');
                if (tickEl) {
                    tickEl.innerHTML = '<i class="fas fa-check-double"></i>';
                    tickEl.className = 'ticks seen';
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, payload => {
            // Profile logic removed from here as we use messages now
        })
        .subscribe();

    // 2. Real-time Presence (Aggressive Sync)
    presenceChannel = supabase.channel('presence-room', {
        config: {
            presence: { key: me }
        }
    });

    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            let found = false;
            for (const key in state) {
                if (state[key].some(p => p.user === target)) {
                    found = true;
                    break;
                }
            }
            // If Presence sync finds them, update UI immediately
            updateStatusUI(found);
        })
        .on('broadcast', { event: 'activity' }, (payload) => {
            // payload.payload contains { user, type, status }
            if (payload.payload.user === target) {
                handleActivity(payload.payload.type, payload.payload.status);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ user: me, online_at: new Date().toISOString() });
                await updatePresence(true);
            }
        });

    // 3. Fallback Poll (Ultra Fast 1.5s as requested)
    setInterval(async () => {
        const { data } = await supabase.from('users').select('online, last_seen').eq('name', target).single();
        if (data) {
            // Check if last_seen was in the last 6 seconds (tighter window for speed)
            const lastSeenDate = new Date(data.last_seen);
            const now = new Date();
            const isRecent = (now - lastSeenDate) < 6000;
            updateStatusUI(data.online && isRecent);
        }
    }, 1500);

    // 4. Self Heartbeat (Super aggressive 2s for "instant" update)
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            updatePresence(true);
        }
    }, 2000);

    checkInitialPresence();
}

async function checkInitialPresence() {
    const { data } = await supabase.from('users').select('*').eq('name', target).single();
    if (data) {
        if (!targetIsOnline) updateStatusUI(data.online, data.last_seen);
    }
}

function updateStatusUI(online, lastSeen) {
    if (targetIsOnline !== online) {
        targetIsOnline = online;

        // Only update text if no activity is happening
        if (!currentActivity) {
            const statusText = document.getElementById('target-status');
            statusText.innerText = online ? 'Online' : 'Offline';
            statusText.style.color = online ? '#4ade80' : '#94a3b8';
        }

        const onlineDot = document.getElementById('online-dot');
        if (onlineDot) {
            if (online) onlineDot.classList.add('active');
            else onlineDot.classList.remove('active');
        }

        if (online) {
            document.querySelectorAll('.msg-me .ticks:not(.seen)').forEach(tick => {
                tick.innerHTML = '<i class="fas fa-angle-double-right"></i>';
                tick.className = 'ticks online-double';
            });
        }
    }
}


function handleActivity(type, status) {
    const statusText = document.getElementById('target-status');
    const activityText = document.getElementById('target-activity');
    if (!statusText || !activityText) return;

    // Clear any existing activity timeouts
    if (window.activityTimeout) clearTimeout(window.activityTimeout);

    if (status) {
        currentActivity = type;

        // Hide "Online" text and show activity text
        statusText.style.display = 'none';
        activityText.innerText = type === 'typing' ? 'typing...' : 'voice....';
        activityText.className = 'activity-text' + (type === 'recording' ? ' recording' : '');
        activityText.style.display = 'block';

        // Auto-clear status after 4 seconds for safety
        window.activityTimeout = setTimeout(() => {
            currentActivity = null;
            statusText.innerText = targetIsOnline ? 'Online' : 'Offline';
            statusText.style.color = targetIsOnline ? '#4ade80' : '#94a3b8';
            statusText.style.display = 'block';
            activityText.style.display = 'none';
            activityText.innerText = '';
        }, 4000);
    } else {
        // Explicit stop
        currentActivity = null;
        statusText.innerText = targetIsOnline ? 'Online' : 'Offline';
        statusText.style.color = targetIsOnline ? '#4ade80' : '#94a3b8';
        statusText.style.display = 'block';
        activityText.style.display = 'none';
        activityText.innerText = '';
    }

    // Update the floating indicator in the message area (lower area)
    const indicator = document.getElementById('activity-indicator');
    if (indicator) {
        if (currentActivity && status) {
            indicator.innerText = currentActivity === 'typing' ? 'typing...' : 'recording audio...';
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    }
}

async function sendActivity(type, status) {
    if (!presenceChannel) return;
    await presenceChannel.send({
        type: 'broadcast',
        event: 'activity',
        payload: { user: me, type, status }
    });
}

// Android Bridge Functions (Optimized)
window.forceOffline = async () => {
    // Untrack presence AND update table for double safety
    if (presenceChannel) presenceChannel.untrack();
    await supabase.from('users').upsert({ name: me, online: false, last_seen: new Date().toISOString() });
};

window.forceOnline = async () => {
    if (presenceChannel) presenceChannel.track({ user: me, online_at: new Date().toISOString() });
    await updatePresence(true);
};

// Refresh Status Function
window.refreshStatus = async () => {
    const icon = document.querySelector('.dropdown-menu button i.fa-sync-alt');
    if (icon) icon.classList.add('fa-spin');

    // Manual pull from database
    const { data } = await supabase.from('users').select('*').eq('name', target).single();
    if (data) {
        const lastSeenDate = new Date(data.last_seen);
        const now = new Date();
        const isRecent = (now - lastSeenDate) < 6000;
        updateStatusUI(data.online && isRecent);
    }

    setTimeout(() => {
        if (icon) icon.classList.remove('fa-spin');
    }, 1000);
};

window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') window.forceOffline();
    else window.forceOnline();
});

/* --- Media Handling (Fixed for Android) --- */
window.triggerFile = (type) => {
    const menu = document.getElementById('attach-menu');
    if (menu) menu.classList.remove('active');
    document.getElementById(`${type}-input`).click();
};

const uploadMedia = async (file, type) => {
    if (!file) return;

    const loaderId = 'loader-' + Date.now();
    const loaderDiv = document.createElement('div');
    loaderDiv.id = loaderId;
    loaderDiv.className = 'media-loader fade-in';
    loaderDiv.innerHTML = `<div class="spinner"></div><span class="loader-text">Sending ${type}...</span>`;
    msgContainer.appendChild(loaderDiv);
    scrollToBottom();

    try {
        let bucket = type === 'voice' ? 'voices' : (type === 'image' ? 'images' : 'videos');
        let ext = file.name ? file.name.split('.').pop() : (type === 'voice' ? 'webm' : (type === 'video' ? 'mp4' : 'jpg'));
        let fileName = `${Date.now()}.${ext}`;

        // Prepare proper content type
        let cType = file.type;
        if (!cType || cType === "") {
            if (type === 'voice') cType = 'audio/webm';
            else if (type === 'video') cType = 'video/mp4';
            else if (type === 'image') cType = 'image/jpeg';
        }

        const { data, error: upErr } = await supabase.storage.from(bucket).upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: cType
        });

        if (upErr) throw upErr;

        const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
        await sendMessage(type, publicUrl);
    } catch (err) {
        console.error("Upload Detailed Error:", err);
        alert("Upload Failed! Check internet or file size. Error: " + (err.message || err.error_description || "Unknown"));
    } finally {
        const el = document.getElementById(loaderId);
        if (el) el.remove();
    }
};



document.getElementById('image-input').onchange = e => uploadMedia(e.target.files[0], 'image');
document.getElementById('video-input').onchange = e => uploadMedia(e.target.files[0], 'video');

/* --- Voice --- */
voiceBtn.onclick = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            if (audioChunks.length > 0) {
                const blob = new Blob(audioChunks, { type: mimeType });
                await uploadMedia(blob, 'voice');
            }
            stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        startRecordingUI();
        sendActivity('recording', true);
    } catch (e) { alert("Mic blocked or not found."); }
};

window.stopAndSendVoice = () => {
    if (mediaRecorder) mediaRecorder.stop();
    stopRecordingUI();
    sendActivity('recording', false);
};
window.cancelRecording = () => {
    if (mediaRecorder) {
        mediaRecorder.onstop = null;
        if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }
    audioChunks = [];
    stopRecordingUI();
    sendActivity('recording', false);
};

function startRecordingUI() {
    document.getElementById('recording-bar').style.display = 'flex';
    document.getElementById('msg-input').style.visibility = 'hidden';
    document.getElementById('attach-btn').style.visibility = 'hidden';
    document.getElementById('send-rec-btn').style.display = 'flex';
    document.getElementById('voice-btn').style.display = 'none';

    let s = 0;
    recordingInterval = setInterval(() => {
        s++;
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        document.getElementById('recording-timer').innerText = `${mins}:${secs.toString().padStart(2, '0')}`;

        // Heartbeat for recording status
        if (s % 2 === 0) sendActivity('recording', true);
    }, 1000);
}

function stopRecordingUI() {
    const recBar = document.getElementById('recording-bar');
    if (recBar) recBar.style.display = 'none';

    document.getElementById('msg-input').style.visibility = 'visible';
    document.getElementById('attach-btn').style.visibility = 'visible';
    document.getElementById('send-rec-btn').style.display = 'none';
    document.getElementById('voice-btn').style.display = 'flex';

    clearInterval(recordingInterval);
    document.getElementById('recording-timer').innerText = '0:00';
}

/* --- UI Helpers --- */
function toggleBtn() {
    const hasText = msgInput.value.trim().length > 0;
    sendBtn.style.display = hasText ? 'block' : 'none';
    voiceBtn.style.display = hasText ? 'none' : 'block';
}

msgInput.oninput = () => {
    toggleBtn();

    // Typing status logic
    if (!isTypingLocal) {
        isTypingLocal = true;
        sendActivity('typing', true);
    }

    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTypingLocal = false;
        sendActivity('typing', false);
    }, 2000); // Stop typing status after 2s of inactivity
};
sendBtn.onclick = () => { if (msgInput.value.trim()) sendMessage('text', msgInput.value.trim()); };
msgInput.onkeypress = e => { if (e.key === 'Enter') sendBtn.click(); };

const modalOverlay = document.getElementById('modal-overlay');
const clearModal = document.getElementById('clear-chat-modal');
const passModal = document.getElementById('password-modal');
const newPassInput = document.getElementById('new-password-input');

// window.goBack removed per user request


// --- Custom Modal Triggers ---
window.clearMessages = () => {
    modalOverlay.classList.add('active');
    clearModal.classList.add('active');
};

window.changeAppPassword = () => {
    modalOverlay.classList.add('active');
    passModal.classList.add('active');
    newPassInput.focus();
};

window.closeModal = () => {
    modalOverlay.classList.remove('active');
    clearModal.classList.remove('active');
    passModal.classList.remove('active');
    const profModal = document.getElementById('profile-viewer-modal');
    if (profModal) profModal.classList.remove('active');
    newPassInput.value = '';
};

// --- Profile Upload ---
window.triggerProfileUpload = () => {
    document.getElementById('profile-input').click();
};

document.getElementById('profile-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const loaderId = 'loader-profile';
    const loaderDiv = document.createElement('div');
    loaderDiv.id = loaderId;
    loaderDiv.className = 'media-loader fade-in';
    loaderDiv.style.position = 'fixed';
    loaderDiv.style.top = '70px';
    loaderDiv.style.right = '20px';
    loaderDiv.innerHTML = `<div class="spinner"></div><span class="loader-text">Updating Profile...</span>`;
    document.body.appendChild(loaderDiv);

    try {
        const fileName = `profile_${me}_${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage.from('images').upload(fileName, file);
        if (upErr) throw upErr;

        const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);

        // Instead of updating 'users' table (which lacks the column), 
        // we send a special hidden message to sync profiles
        const { error: dbErr } = await supabase.from('messages').insert([{
            chat_id: chatId,
            sender: me,
            receiver: target,
            type: 'profile_pic',
            content: publicUrl,
            seen: true
        }]);

        if (dbErr) throw dbErr;

        profilePics[me] = publicUrl;
        updateProfileUI();
        alert("Profile picture updated!");
    } catch (err) {
        alert("Failed to update profile picture: " + err.message);
    } finally {
        if (document.getElementById(loaderId)) document.getElementById(loaderId).remove();
    }
};

// --- Image Viewer functions ---
window.openImageViewer = (src) => {
    const viewer = document.getElementById('image-viewer');
    const viewedImg = document.getElementById('viewed-image');
    if (viewer && viewedImg) {
        viewedImg.src = src;
        viewer.classList.add('active');
    }
};

window.closeImageViewer = () => {
    const viewer = document.getElementById('image-viewer');
    if (viewer) {
        viewer.classList.remove('active');
    }
};

// --- Confirmations ---
window.confirmClearChat = async () => {
    const { error } = await supabase.from('messages')
        .delete()
        .eq('chat_id', chatId)
        .in('type', ['text', 'image', 'video', 'voice']);
    if (error) alert("Error clearing: " + error.message);
    else msgContainer.innerHTML = '';
    closeModal();
};

window.submitNewPassword = async () => {
    const val = newPassInput.value.trim();
    if (val) {
        // Update local storage for calculator only
        localStorage.setItem('calc_password', val);

        try {
            // Sync Calculator Password to Database for all devices (Cloud Base)
            await supabase.from('messages').insert([{
                chat_id: chatId,
                sender: me,
                receiver: target,
                type: 'calculator_password',
                content: val,
                seen: true
            }]);

            alert("Calculator Password updated successfully!");
            closeModal();
        } catch (e) {
            console.error("Failed to sync password:", e);
            alert("Updated locally, but failed to sync to cloud.");
        }
    }
};

function scrollToBottom() { msgContainer.scrollTop = msgContainer.scrollHeight; }
async function markAsSeen() { await supabase.from('messages').update({ seen: true }).eq('receiver', me).eq('seen', false); }

init();

// Menu handling
const attachBtn = document.getElementById('attach-btn');
const menuBtn = document.getElementById('menu-btn');

if (attachBtn) {
    attachBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const attachMenu = document.getElementById('attach-menu');
        const dropdownMenu = document.getElementById('dropdown-menu');
        if (attachMenu) attachMenu.classList.toggle('active');
        if (dropdownMenu) dropdownMenu.classList.remove('active');
    };
}

if (menuBtn) {
    menuBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dropdownMenu = document.getElementById('dropdown-menu');
        const attachMenu = document.getElementById('attach-menu');
        if (dropdownMenu) dropdownMenu.classList.toggle('active');
        if (attachMenu) attachMenu.classList.remove('active');
    };
}

// Global click to close menus
document.addEventListener('click', (e) => {
    const attachMenu = document.getElementById('attach-menu');
    const dropdownMenu = document.getElementById('dropdown-menu');
    const attachBtn = document.getElementById('attach-btn');
    const menuBtn = document.getElementById('menu-btn');

    if (attachMenu && attachBtn && !attachBtn.contains(e.target) && !attachMenu.contains(e.target)) {
        attachMenu.classList.remove('active');
    }
    if (dropdownMenu && menuBtn && !menuBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
        dropdownMenu.classList.remove('active');
    }
});
