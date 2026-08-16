const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// MongoDB Atlas Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:AdminPass123@cluster0.gpgplkf.mongodb.net/gatepass?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Pass Schema with Year & Section
const passSchema = new mongoose.Schema({
    rollNo: { type: String, required: true },
    name: { type: String, required: true },
    dept: { type: String, default: 'CSE' },
    year: { type: String, default: 'III' },
    sec: { type: String, default: 'A' },
    mobile: { type: String, default: '-' },
    address: { type: String, default: 'Hostel' },
    status: { type: String, default: 'Approved' },
    approvedAt: { type: String },
    validUntil: { type: String },
    exitTime: { type: String, default: '-' }
});

const Pass = mongoose.model('Pass', passSchema);

// Frontend Page Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/security', (req, res) => {
    res.sendFile(path.join(__dirname, 'security.html'));
});

// Helper: Format to exact Indian Standard Time (IST)
function getCurrentIST() {
    return new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function getExpiryIST(hours = 6) {
    const d = new Date(Date.now() + hours * 60 * 60 * 1000);
    return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// API: Get All Passes
app.get('/api/passes', async (req, res) => {
    try {
        const passes = await Pass.find().sort({ _id: -1 });
        res.json(passes);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Approve / Issue Pass
app.post('/api/approve', async (req, res) => {
    try {
        const { rollNo, name, dept, year, sec, mobile, address } = req.body;

        const newPass = new Pass({
            rollNo: rollNo ? rollNo.trim() : '',
            name: name ? name.trim() : 'Student',
            dept: dept ? dept.trim() : 'CSE',
            year: year ? year.trim() : 'III',
            sec: sec ? sec.trim() : 'A',
            mobile: mobile ? mobile.trim() : '-',
            address: address ? address.trim() : 'Campus / Hostel',
            status: 'Approved',
            approvedAt: getCurrentIST(),
            validUntil: getExpiryIST(6),
            exitTime: '-'
        });

        await newPass.save();
        res.json({ success: true, pass: newPass });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Security Scanner Verification
app.post('/api/scan', async (req, res) => {
    try {
        const { rollNo } = req.body;
        if (!rollNo) {
            return res.json({ success: false, message: 'Invalid Roll Number' });
        }

        const pass = await Pass.findOne({
            rollNo: rollNo.trim(),
            status: 'Approved'
        }).sort({ _id: -1 });

        if (!pass) {
            return res.json({ success: false, message: 'No Approved Pass Found' });
        }

        pass.status = 'Exited';
        pass.exitTime = getCurrentIST();
        await pass.save();

        res.json({ success: true, pass: pass });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
