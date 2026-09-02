const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const https = require('https');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- 1. MONGODB ATLAS CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:AdminPass123@cluster0.gpgplkf.mongodb.net/gatepass?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 2. IST TIME HELPER ---
function getISTTimeString(date = new Date()) {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// --- 3. DATABASE SCHEMAS ---

// User Schema for Authentication
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, // Roll No or Staff Email
  name: { type: String, required: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    required: true, 
    enum: ['student', 'counselor', 'advisor', 'hod', 'principal', 'security'] 
  },
  dept: { type: String, default: 'CSE' },
  year: { type: String, default: 'III' },
  sec: { type: String, default: 'A' },
  batch: { type: String, default: 'Batch 1 (1-20)' }, // For Counselors & Students
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Student Master Roster (Uploaded by Counselors)
const StudentSchema = new mongoose.Schema({
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, required: true },
  year: { type: String, required: true },
  sec: { type: String, required: true },
  batch: { type: String, required: true },
  counselorName: { type: String, default: 'Counselor' },
  mobile: { type: String, default: '-' },
  parentContact: { type: String, default: '-' },
  address: { type: String, default: 'Hostel / Day Scholar' }
});
const Student = mongoose.model('Student', StudentSchema);

// Pass Workflow Schema
const PassSchema = new mongoose.Schema({
  rollNo: { type: String, required: true },
  name: String,
  dept: String,
  year: String,
  sec: String,
  batch: String,
  parentContact: String,
  reason: { type: String, required: true },
  status: {
    type: String,
    enum: ['Pending Counselor', 'Pending Advisor', 'Pending HOD', 'Pending Principal', 'Approved', 'Exited', 'Expired', 'Rejected'],
    default: 'Pending Counselor'
  },
  counselorApproval: { counselorName: String, approved: Boolean, parentCalled: Boolean, time: String },
  advisorApproval: { approved: Boolean, time: String },
  hodApproval: { approved: Boolean, time: String },
  principalApproval: { approved: Boolean, time: String },
  approvalTime: String,
  expiresAt: Date,
  exitTime: { type: String, default: '-' },
  photo: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Pass = mongoose.model('Pass', PassSchema);

// --- 4. AUTHENTICATION ROUTES ---

// Registration Route
app.post('/api/auth/register', async (req, res) => {
  try {
    const { userId, name, password, role, dept, year, sec, batch } = req.body;
    const cleanId = (userId || '').trim().toLowerCase();

    if (!cleanId || !name || !password || !role) {
      return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
    }

    const existingUser = await User.findOne({ userId: cleanId });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Account already exists. Please Log In.' });
    }

    const newUser = new User({
      userId: cleanId,
      name: name.trim(),
      password: password.trim(),
      role,
      dept: dept || 'CSE',
      year: year || 'III',
      sec: sec || 'A',
      batch: batch || 'Batch 1 (1-20)'
    });

    await newUser.save();
    res.json({ success: true, message: 'Registration successful! You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    const cleanId = (userId || '').trim().toLowerCase();

    const user = await User.findOne({ userId: cleanId, password: password.trim() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid ID/Email or Password.' });
    }

    res.json({
      success: true,
      message: 'Login successful!',
      user: {
        userId: user.userId,
        name: user.name,
        role: user.role,
        dept: user.dept,
        year: user.year,
        sec: user.sec,
        batch: user.batch
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 5. WORKFLOW & APP ROUTES ---

// Serve Unified Single App
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Pass Queries
app.get('/api/passes', async (req, res) => {
  try {
    const { status, dept, year, sec, batch } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (dept) filter.dept = dept.toUpperCase();
    if (year) filter.year = year.toUpperCase();
    if (sec) filter.sec = sec.toUpperCase();
    if (batch) filter.batch = batch;

    const passes = await Pass.find(filter).sort({ createdAt: -1 });
    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Counselor Uploads Batch
app.post('/api/upload-students', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Please select an Excel file" });
    const { dept, year, sec, batch, counselorName } = req.body;

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });

    let headerRowIdx = rows.findIndex(r => r.some(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, '').includes('roll')));
    if (headerRowIdx === -1) headerRowIdx = 0;

    const rawHeaders = rows[headerRowIdx].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const getCol = (keys) => rawHeaders.findIndex(h => keys.some(k => h.includes(k)));

    const rollIdx = getCol(['roll', 'reg', 'id']);
    const nameIdx = getCol(['name']);
    const mobileIdx = getCol(['mobile', 'phone']);
    const parentIdx = getCol(['parent', 'father', 'guardian']);

    let count = 0;
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      let rollNo = rollIdx !== -1 && row[rollIdx] ? String(row[rollIdx]).trim() : '';
      if (!rollNo || rollNo.toLowerCase().includes('roll')) continue;

      await Student.findOneAndUpdate(
        { rollNo },
        {
          rollNo,
          name: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : 'Student',
          dept: dept.toUpperCase(),
          year: year.toUpperCase(),
          sec: sec.toUpperCase(),
          batch,
          counselorName: counselorName || 'Counselor',
          mobile: mobileIdx !== -1 && row[mobileIdx] ? String(row[mobileIdx]).trim() : '-',
          parentContact: parentIdx !== -1 && row[parentIdx] ? String(row[parentIdx]).trim() : '-'
        },
        { upsert: true }
      );
      count++;
    }
    res.json({ success: true, message: `Successfully registered ${count} students under ${batch}!`, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Student Submits Pass
app.post('/api/apply-pass', async (req, res) => {
  try {
    const { rollNo, reason } = req.body;
    const student = await Student.findOne({ rollNo: (rollNo || '').trim() });
    if (!student) return res.status(404).json({ success: false, message: "Student roll number not registered by counselor." });

    const newPass = new Pass({
      rollNo: student.rollNo,
      name: student.name,
      dept: student.dept,
      year: student.year,
      sec: student.sec,
      batch: student.batch,
      parentContact: student.parentContact,
      reason: reason.trim(),
      status: 'Pending Counselor'
    });

    await newPass.save();
    res.json({ success: true, message: `Applied! Sent to ${student.counselorName} for parent verification.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Counselor Approval
app.post('/api/approve/counselor', async (req, res) => {
  try {
    const { passId, parentCalled, counselorName } = req.body;
    const pass = await Pass.findById(passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    pass.status = 'Pending Advisor';
    pass.counselorApproval = { counselorName, approved: true, parentCalled: !!parentCalled, time: getISTTimeString() };
    await pass.save();
    res.json({ success: true, message: 'Forwarded to Class Advisor.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Advisor Approval
app.post('/api/approve/advisor', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    pass.status = 'Pending HOD';
    pass.advisorApproval = { approved: true, time: getISTTimeString() };
    await pass.save();
    res.json({ success: true, message: 'Forwarded to HOD.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HOD Approval
app.post('/api/approve/hod', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    pass.status = 'Pending Principal';
    pass.hodApproval = { approved: true, time: getISTTimeString() };
    await pass.save();
    res.json({ success: true, message: 'Forwarded to Principal/Admin.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Principal / Admin Final Approval
app.post('/api/approve/principal', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    const now = new Date();
    pass.status = 'Approved';
    pass.principalApproval = { approved: true, time: getISTTimeString(now) };
    pass.approvalTime = getISTTimeString(now);
    pass.expiresAt = new Date(now.getTime() + 20 * 60 * 1000); // 20-minute gate countdown
    await pass.save();
    res.json({ success: true, message: 'Exit clearance granted! 20-minute gate timer running.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Security Scan Verification
app.post('/api/scan-pass', async (req, res) => {
  try {
    const rollNo = (req.body.rollNo || '').trim();
    const pass = await Pass.findOne({ rollNo, status: 'Approved' }).sort({ createdAt: -1 });

    if (!pass) return res.status(400).json({ success: false, message: `No active pass found for: ${rollNo}` });

    const now = new Date();
    if (now > pass.expiresAt) {
      pass.status = 'Expired';
      await pass.save();
      return res.status(400).json({ success: false, message: 'Pass Expired! 20-min window exceeded.' });
    }

    pass.status = 'Exited';
    pass.exitTime = getISTTimeString(now);
    await pass.save();
    res.json({ success: true, pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Keep-alive heartbeat
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 GateMatrix running on port ${PORT}`));

setInterval(() => {
  https.get('https://gate-pass-app-t0gq.onrender.com/api/passes', () => {}).on('error', () => {});
}, 10 * 60 * 1000);
