const express = require('express');
const cors = require('cors');
const initDB = require('./models/database');
const listingRoutes = require('./routes/listing');
const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/request');

const app = express();
app.use(express.json());
app.use(cors());

let db;

app.use((req, res, next) => {
    if (!db) {
        return res.status(503).json({ error: 'Database is still initializing. Please retry in a moment.' });
    }

    req.db = db;
    next();
});

app.use('/api/auth', authRoutes);
app.use('/api/listing', listingRoutes);
app.use('/api/request', requestRoutes);

const PORT = 5001;

initDB()
    .then((database) => {
        db = database;
        console.log('Database ready');
        app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
    })
    .catch((error) => {
        console.error('Failed to initialize database', error);
        process.exit(1);
    });
