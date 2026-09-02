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

// --- 1. MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:AdminPass123@cluster0.gpgplkf.mongodb.net/gatepass?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
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

// --- 3. SCHEMAS ---
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, required: true },
  dept: { type: String, default: 'CSE' },
  yearSec: { type: String, default: 'III-A' },
  batch: { type: String, default: 'Batch 1' },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const StudentSchema = new mongoose.Schema({
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, required: true },
  yearSec: { type: String, default: 'III-A' },
  batch: { type: String, default: 'Batch 1' },
  counselorName: { type: String, default: 'Class Counselor' },
  mobile: { type: String, default: '-' },
  parentContact: { type: String, required: true },
  address: { type: String, default: 'Campus / Hostel' }
});
const Student = mongoose.model('Student', StudentSchema);

const PassSchema = new mongoose.Schema({
  rollNo: { type: String, required: true },
  name: String,
  dept: String,
  yearSec: String,
  batch: String,
  parentContact: String,
  reason: { type: String, required: true },
  
  status: {
    type: String,
    enum: ['Pending Counselor', 'Pending Advisor', 'Pending HOD', 'Pending Principal', 'Approved', 'Exited', 'Expired', 'Rejected'],
    default: 'Pending Counselor'
  },

  // Phone Call Verification Audit Trail
  counselorApproval: {
    counselorName: String,
    approved: { type: Boolean, default: false },
    parentCalled: { type: Boolean, default: false },
    callStatus: { type: String, default: 'Not Verified' },
    time: String
  },
  advisorApproval: { approved: { type: Boolean, default: false }, time: String },
  hodApproval: { approved: { type: Boolean, default: false }, time: String },
  principalApproval: { approved: { type: Boolean, default: false }, time: String },

  approvalTime: String,
  expiresAt: Date,
  exitStatus: { type: String, default: 'Inside Campus' }, // 'Inside Campus' or 'Exited Campus'
  exitTime: { type: String, default: '-' }, // Stores full Date & Time (DD/MM/YYYY, HH:MM:SS AM/PM)
  createdAt: { type: Date, default: Date.now }
});
const Pass = mongoose.model('Pass', PassSchema);

// --- 4. AUTHENTICATION ROUTES ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { userId, name, password, role, dept, yearSec, batch } = req.body;
    const cleanId = (userId || '').trim().toLowerCase();

    const existing = await User.findOne({ userId: cleanId });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists. Please login.' });

    const newUser = new User({
      userId: cleanId,
      name: name.trim(),
      password: password.trim(),
      role,
      dept: dept || 'CSE',
      yearSec: yearSec || 'III-A',
      batch: batch || 'Batch 1'
    });
    await newUser.save();
    res.json({ success: true, message: 'Registration successful! You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    const cleanId = (userId || '').trim().toLowerCase();

    const user = await User.findOne({ userId: cleanId, password: password.trim() });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid ID/Roll Number or Password.' });

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 5. EXCEL UPLOAD BY COUNSELOR ---
app.post('/api/upload-students', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Please select an Excel file" });
    const { dept, yearSec, batch, counselorName } = req.body;

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });

    let headerIdx = rows.findIndex(r => r.some(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, '').includes('roll')));
    if (headerIdx === -1) headerIdx = 0;

    const rawHeaders = rows[headerIdx].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const getCol = (keys) => rawHeaders.findIndex(h => keys.some(k => h.includes(k)));

    const rollIdx = getCol(['roll', 'reg', 'id']);
    const nameIdx = getCol(['name', 'studentname']);
    const parentIdx = getCol(['parent', 'mobile', 'phone', 'contact', 'father', 'guardian']);

    let count = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      let rollNo = rollIdx !== -1 && row[rollIdx] ? String(row[rollIdx]).trim() : '';
      if (!rollNo || rollNo.toLowerCase().includes('roll')) continue;

      const parentContact = parentIdx !== -1 && row[parentIdx] ? String(row[parentIdx]).trim() : '-';

      await Student.findOneAndUpdate(
        { rollNo },
        {
          rollNo,
          name: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : 'Student',
          dept: (dept || 'CSE').trim().toUpperCase(),
          yearSec: (yearSec || 'III-A').trim().toUpperCase(),
          batch: (batch || 'Batch 1').trim(),
          counselorName: counselorName || 'Counselor',
          parentContact
        },
        { upsert: true }
      );
      count++;
    }
    res.json({ success: true, message: `Successfully registered ${count} students with parent phone numbers!`, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- 6. WORKFLOW ENDPOINTS ---

// Fetch Passes (Filterable)
app.get('/api/passes', async (req, res) => {
  try {
    const { status, dept } = req.query;
    let filter = {};
    if (status) filter.status = status;
    if (dept) filter.dept = dept.toUpperCase();
    const passes = await Pass.find(filter).sort({ createdAt: -1 });
    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student Applies
app.post('/api/apply-pass', async (req, res) => {
  try {
    const { rollNo, reason } = req.body;
    const student = await Student.findOne({ rollNo: (rollNo || '').trim() });
    if (!student) return res.status(404).json({ success: false, message: "Roll number not found in student roster. Please ask your counselor to upload your batch." });

    const newPass = new Pass({
      rollNo: student.rollNo,
      name: student.name,
      dept: student.dept,
      yearSec: student.yearSec,
      batch: student.batch,
      parentContact: student.parentContact,
      reason: reason.trim(),
      status: 'Pending Counselor',
      exitStatus: 'Inside Campus',
      exitTime: '-'
    });

    await newPass.save();
    res.json({ success: true, message: `Application submitted! Forwarded to Counselor (${student.counselorName}) for parent call verification.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Counselor Approval with Parent Phone Verification
app.post('/api/approve/counselor', async (req, res) => {
  try {
    const { passId, parentCalled, counselorName } = req.body;
    const pass = await Pass.findById(passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    pass.status = 'Pending Advisor';
    pass.counselorApproval = {
      counselorName: counselorName || 'Counselor',
      approved: true,
      parentCalled: !!parentCalled,
      callStatus: parentCalled ? 'Parent Approved via Phone Call' : 'Unconfirmed',
      time: getISTTimeString()
    };
    await pass.save();
    res.json({ success: true, message: 'Parent verification saved! Forwarded to Class Advisor.' });
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
    res.json({ success: true, message: 'Approved by Class Advisor. Forwarded to HOD.' });
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
    res.json({ success: true, message: 'Approved by HOD. Forwarded to Principal.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Principal Approval (Starts 20-Min Exit Validity)
app.post('/api/approve/principal', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    const now = new Date();
    pass.status = 'Approved';
    pass.principalApproval = { approved: true, time: getISTTimeString(now) };
    pass.approvalTime = getISTTimeString(now);
    pass.expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
    await pass.save();
    res.json({ success: true, message: 'Principal approval granted! Student authorized to exit.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Security Scan at Main Gate
app.post('/api/scan-pass', async (req, res) => {
  try {
    const cleanRollNo = (req.body.rollNo || '').trim();
    const pass = await Pass.findOne({ rollNo: cleanRollNo, status: 'Approved' }).sort({ createdAt: -1 });

    if (!pass) return res.status(400).json({ success: false, message: `No active pass found for ID: ${cleanRollNo}` });

    const now = new Date();
    if (now > pass.expiresAt) {
      pass.status = 'Expired';
      await pass.save();
      return res.status(400).json({ success: false, message: 'Pass Expired! 20-minute validity window ended.' });
    }

    pass.status = 'Exited';
    pass.exitStatus = 'Exited Campus';
    pass.exitTime = getISTTimeString(now); // Full Date & Time with seconds in IST
    await pass.save();

    res.json({ success: true, pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 7. STATIC ROUTES & KEEP ALIVE ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 GateMatrix running on port ${PORT}`));

setInterval(() => {
  https.get('https://gate-pass-app-t0gq.onrender.com/api/passes', () => {}).on('error', () => {});
}, 10 * 60 * 1000);
