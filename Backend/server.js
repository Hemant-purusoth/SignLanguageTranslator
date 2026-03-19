// backend/server.js

const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ===== CONFIG =====
const PORT = process.env.PORT || 4000;

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());

// ===== SERVE FRONTEND =====
// This serves your entire Frontend folder
app.use(express.static(path.join(__dirname, '../Frontend')));

// ===== SERVE MODELS =====
// Models should be inside backend/models
app.use('/models', express.static(path.join(__dirname, 'models')));

// ===== FILE UPLOAD SETUP =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({ storage });

// ===== ROUTES =====
app.get('/', (req, res) => {
  res.send('Sign Language Backend Running');
});

// Upload endpoint
app.post('/upload-sample', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No file uploaded' });
  }

  return res.json({
    ok: true,
    path: `/uploads/${req.file.filename}`,
    label: req.body.label || null
  });
});

// Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===== SOCKET.IO =====
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join-room', (room) => {
    socket.join(room);
    socket.to(room).emit('user-joined', { id: socket.id });
  });

  socket.on('signal', (data) => {
    if (data && data.to) {
      socket.to(data.to).emit('signal', {
        from: socket.id,
        signal: data.signal
      });
    }
  });

  socket.on('translation', (payload) => {
    if (payload && payload.room) {
      socket.to(payload.room).emit('translation', {
        from: socket.id,
        text: payload.text
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// ===== START SERVER =====
server.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
