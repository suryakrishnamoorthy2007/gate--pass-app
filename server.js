require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:AdminPass123@cluster0.gpgplkf.mongodb.net/gatepass?retryWrites=true&w=majority";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Indian Standard Time (IST) Formatter Helper
function getISTTime() {
    return new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function getISTExpiryTime(hoursValid = 6) {
    const d = new Date(Date.now() + hoursValid * 60 * 60 * 1000);
    return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// Database Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Pass Schema with Year & Section
const passSchema = new mongoose.Schema({
    rollNo: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    dept: { type: String, default: 'CSE' },
    year: { type: String, default: 'III' },
    section: { type: String, default: 'A' },
    address: { type: String, default: 'Hostel' },
    reason: { type: String, default: 'Personal Work' },
    status: { type: String, default: 'Approved' }, // Approved, Exited, Expired
    approvedAt: { type: String },
    validUntil: { type: String },
    exitTime: { type: String, default: '-' }
}, { timestamps: true });

const Pass = mongoose.model('Pass', passSchema);

// Frontend Routes
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/security', (req, res) => {
    res.sendFile(path.join(__dirname, 'security.html'));
});

// API: Get All Passes
app.get('/api/passes', async (req, res) => {
    try {
        const passes = await Pass.find().sort({ createdAt: -1 });
        res.json({ success: true, data: passes });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Create / Issue New Pass
app.post('/api/pass/issue', async (req, res) => {
    try {
        const { rollNo, name, dept, year, section, address, reason } = req.body;
        
        if (!rollNo || !name) {
            return res.status(400).json({ success: false, message: 'Roll Number and Name are required.' });
        }

        const newPass = new Pass({
            rollNo: rollNo.toUpperCase(),
            name,
            dept: dept || 'CSE',
            year: year || 'III',
            section: (section || 'A').toUpperCase(),
            address: address || 'Anna Nagar, Chennai',
            reason: reason || 'Home / Outing',
            status: 'Approved',
            approvedAt: getISTTime(),
            validUntil: getISTExpiryTime(6),
            exitTime: '-'
        });

        await newPass.save();
        res.json({ success: true, message: 'Pass generated successfully!', data: newPass });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Security Scanner Verification Endpoint
app.post('/api/pass/verify', async (req, res) => {
    try {
        const { rollNo } = req.body;
        if (!rollNo) {
            return res.status(400).json({ success: false, message: 'Invalid Roll Number scanned.' });
        }

        const pass = await Pass.findOne({ 
            rollNo: rollNo.trim().toUpperCase(),
            status: 'Approved'
        }).sort({ createdAt: -1 });

        if (!pass) {
            return res.json({ 
                success: false, 
                message: `No active approved pass found for Roll No: ${rollNo.toUpperCase()}` 
            });
        }

        // Mark as Exited with exact Indian Standard Time
        pass.status = 'Exited';
        pass.exitTime = getISTTime();
        await pass.save();

        res.json({ 
            success: true, 
            message: 'Pass Verified Successfully. Gate Exit Allowed!', 
            data: pass 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Delete Single Pass by ID
app.delete('/api/pass/:id', async (req, res) => {
    try {
        await Pass.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Record deleted successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Delete All Passes (Clear Table)
app.delete('/api/passes/clear-all', async (req, res) => {
    try {
        await Pass.deleteMany({});
        res.json({ success: true, message: 'All pass records have been wiped.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
