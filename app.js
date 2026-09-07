const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const assignmentRoutes = require('./routes/assignments');
const milkRoutes = require('./routes/milk');
const noticeRoutes = require('./routes/noticeBoard');
const summaryRoutes = require('./routes/summaries');
const requestLogger = require('./middleware/requestLogger');

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/milk', milkRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/summaries', summaryRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'השרת עובד מצוין!' });
});

module.exports = app;