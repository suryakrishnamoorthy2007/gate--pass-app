const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// Path to permanent data storage file
const DB_FILE = path.join(__dirname, 'database.json');

// --- DATABASE LOAD & SAVE FUNCTIONS ---

// Function to read stored data from database.json
function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { students: {}, gatePasses: {} };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    try {
        const fileData = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(fileData);
    } catch (err) {
        console.error("Error reading database file, starting fresh:", err);
        return { students: {}, gatePasses: {} };
    }
}

// Function to write updated data to database.json
function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error writing to database file:", err);
    }
}

// Load existing data into memory when server starts
let db = loadDatabase();

// --- ROUTES & ENDPOINTS ---

// Serve HTML pages
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'student.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));

// 1. Register Student Details
app.post('/api/register-student', (req, res) => {
    const { rollNo, name, email, mobile, dept, year, section } = req.body;
    db.students[rollNo] = { name, email, mobile, dept, year, section };
    
    saveDatabase(db); // Save changes permanently

    res.json({ success: true, message: 'Student registered successfully!' });
});

// 2. Admin Approves Pass First (Allocates 20-Min Window)
app.post('/api/admin/approve', (req, res) => {
    const { rollNo } = req.body;
    const student = db.students[rollNo];

    if (!student) {
        return res.status(400).json({ success: false, message: 'Student not registered in system!' });
    }

    const now = new Date();
    const expiry = new Date(now.getTime() + 20 * 60000); // 20 minutes limit
    const passId = 'PASS-' + Date.now();

    // Store ALL student fields directly into gatePasses object
    db.gatePasses[rollNo] = {
        passId,
        rollNo,
        studentName: student.name,
        dept: student.dept || 'N/A',
        year: student.year || 'N/A',
        section: student.section || 'N/A',
        email: student.email || 'N/A',
        mobile: student.mobile || 'N/A',
        status: 'APPROVED', 
        approvedTime: now.toLocaleTimeString(),
        expiryTimestamp: expiry.getTime(),
        expiryTime: expiry.toLocaleTimeString(),
        exitTime: null
    };

    saveDatabase(db); // Save to database.json

    res.json({ success: true, message: `Pass APPROVED for Roll No: ${rollNo} (Valid for 20 mins)` });
});

// 3. Student Generates QR Code (Only if Approved by Admin)
app.post('/api/student/generate-qr', (req, res) => {
    const { rollNo, reason } = req.body;
    const pass = db.gatePasses[rollNo];

    if (!pass) {
        return res.status(400).json({ success: false, message: 'Gate pass NOT APPROVED yet by Office/Admin!' });
    }

    if (Date.now() > pass.expiryTimestamp) {
        pass.status = 'EXPIRED';
        saveDatabase(db);
        return res.status(400).json({ success: false, message: 'Approval EXPIRED! 20-minute window has passed.' });
    }

    if (pass.status === 'EXITED') {
        return res.status(400).json({ success: false, message: 'Pass already used to exit!' });
    }

    // Attach reason provided by student
    pass.reason = reason;
    saveDatabase(db); // Save changes permanently

    res.json({
        success: true,
        pass: {
            rollNo: pass.rollNo,
            passId: pass.passId,
            expiryTime: pass.expiryTime
        }
    });
});

// 4. Admin Gets All Records
app.get('/api/admin/passes', (req, res) => {
    res.json(Object.values(db.gatePasses));
});

// 5. Security Scans Gate Pass
app.post('/api/security/scan', (req, res) => {
    const { passData } = req.body;
    
    let parsedData;
    try {
        parsedData = typeof passData === 'string' ? JSON.parse(passData) : passData;
    } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid QR Code' });
    }

    const pass = db.gatePasses[parsedData.rollNo];

    if (!pass || pass.passId !== parsedData.passId) {
        return res.status(404).json({ success: false, message: 'Unrecognized Gate Pass!' });
    }

    if (pass.status === 'EXITED') {
        return res.status(400).json({ success: false, message: 'Pass already used!' });
    }

    if (Date.now() > pass.expiryTimestamp) {
        pass.status = 'EXPIRED';
        saveDatabase(db);
        return res.status(400).json({ success: false, message: 'PASS EXPIRED! 20-minute limit exceeded.' });
    }

    // Approve Exit and record exact exit time
    pass.status = 'EXITED';
    pass.exitTime = new Date().toLocaleTimeString();

    saveDatabase(db); // Save to database.json

    res.json({
        success: true,
        message: 'OK SCANNED - EXIT PERMITTED',
        exitDetails: {
            studentName: pass.studentName,
            rollNo: pass.rollNo,
            dept: pass.dept,
            year: pass.year,       // <--- ADDED
            section: pass.section, // <--- ADDED
            email: pass.email,     // <--- ADDED
            mobile: pass.mobile,   // <--- ADDED
            reason: pass.reason || 'N/A',
            exitTime: pass.exitTime
        }
    });
});

// 6. Delete Gate Pass Record
app.delete('/api/admin/delete-pass/:rollNo', (req, res) => {
    const { rollNo } = req.params;
    if (db.gatePasses[rollNo]) {
        delete db.gatePasses[rollNo];
        saveDatabase(db);
        return res.json({ success: true, message: `Pass for Roll No ${rollNo} deleted successfully.` });
    }
    res.status(404).json({ success: false, message: 'Pass record not found.' });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});