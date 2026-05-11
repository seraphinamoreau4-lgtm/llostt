require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');

const routes = require('./routes');
const { testConnection } = require('./database');

const app = express();
const httpServer = http.createServer(app);

// ─── SOCKET.IO ────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`🔌 User ${socket.userId} connected`);
  socket.join(`user_${socket.userId}`);

  socket.on('join_conversation', (otherUserId) => {
    socket.join(`conv_${Math.min(socket.userId, otherUserId)}_${Math.max(socket.userId, otherUserId)}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 User ${socket.userId} disconnected`);
  });
});

app.set('io', io);

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const corsOrigin = process.env.FRONTEND_URL || true;
if (!process.env.FRONTEND_URL && process.env.NODE_ENV === 'production') {
  console.warn('⚠️ FRONTEND_URL is not set. CORS will allow all origins. Set FRONTEND_URL in production.');
}

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many requests, please try again later' }
}));
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 200
}));

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Static files (frontend)
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ─── API ROUTES ───────────────────────────────────────────────
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Laikipia University Lost & Found API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
  } else {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: 'File size too large (max 5MB)' });
  }
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// ─── START SERVER ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function start() {
  await testConnection();
  httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║   🎓 Laikipia University Lost & Found API      ║
║   🚀 Server running on http://localhost:${PORT}   ║
║   📊 Environment: ${(process.env.NODE_ENV || 'development').padEnd(26)}║
╚════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

module.exports = app;
