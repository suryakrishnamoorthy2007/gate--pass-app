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

// --- 3. DATABASE SCHEMAS ---
const StudentSchema = new mongoose.Schema({
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, required: true },
  year: { type: String, required: true },
  sec: { type: String, required: true },
  batch: { type: String, required: true }, // Batch 1 (1-20), Batch 2 (21-40), Batch 3 (41-60)
  counselorName: { type: String, default: 'Class Counselor' },
  mobile: { type: String, default: '-' },
  parentContact: { type: String, default: '-' },
  address: { type: String, default: 'Day Scholar / Hostel' }
});
const Student = mongoose.model('Student', StudentSchema);

const PassSchema = new mongoose.Schema({
  rollNo: { type: String, required: true },
  name: String,
  dept: String,
  year: String,
  sec: String,
  batch: String,
  parentContact: String,
  reason: { type: String, required: true },

  // Workflow Progression Status
  status: {
    type: String,
    enum: [
      'Pending Counselor',
      'Pending Advisor',
      'Pending HOD',
      'Pending Principal',
      'Approved',
      'Exited',
      'Expired',
      'Rejected'
    ],
    default: 'Pending Counselor'
  },

  // Audit Trails for Approvals
  counselorApproval: {
    counselorName: String,
    approved: { type: Boolean, default: false },
    parentCalled: { type: Boolean, default: false },
    time: String
  },
  advisorApproval: { approved: { type: Boolean, default: false }, time: String },
  hodApproval: { approved: { type: Boolean, default: false }, time: String },
  principalApproval: { approved: { type: Boolean, default: false }, time: String },

  approvalTime: String,
  expiresAt: Date,
  exitTime: { type: String, default: '-' },
  photo: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Pass = mongoose.model('Pass', PassSchema);

// --- 4. HTML PAGE ROUTES ---
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/apply', (req, res) => res.sendFile(path.join(__dirname, 'apply.html')));
app.get('/counselor', (req, res) => res.sendFile(path.join(__dirname, 'counselor.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));
app.get('/advisor', (req, res) => res.sendFile(path.join(__dirname, 'advisor.html')));

// --- 5. API ROUTES ---

// Total student count
app.get('/api/students/count', async (req, res) => {
  try {
    const count = await Student.countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Counselor uploads batch of 20 students via Excel
app.post('/api/upload-students', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Please select an Excel file" });

    const { dept, year, sec, batch, counselorName } = req.body;

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });

    if (!rows || rows.length === 0) return res.status(400).json({ success: false, message: "Empty file." });

    let headerRowIdx = rows.findIndex(r => r.some(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, '').includes('roll')));
    if (headerRowIdx === -1) headerRowIdx = 0;

    const rawHeaders = rows[headerRowIdx].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const getColIndex = (keys) => rawHeaders.findIndex(h => keys.some(k => h.includes(k)));

    const rollIdx = getColIndex(['roll', 'reg', 'id']);
    const nameIdx = getColIndex(['name', 'studentname']);
    const mobileIdx = getColIndex(['mobile', 'phone', 'contact']);
    const parentIdx = getColIndex(['parent', 'father', 'guardian']);
    const addressIdx = getColIndex(['address', 'hostel', 'city']);

    let count = 0;
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      let rollNo = rollIdx !== -1 && row[rollIdx] ? String(row[rollIdx]).trim() : '';
      if (!rollNo || rollNo.toLowerCase().includes('roll')) continue;

      await Student.findOneAndUpdate(
        { rollNo },
        {
          rollNo,
          name: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : 'Student',
          dept: (dept || 'CSE').trim().toUpperCase(),
          year: (year || 'III').trim().toUpperCase(),
          sec: (sec || 'A').trim().toUpperCase(),
          batch: (batch || 'Batch 1 (1-20)').trim(),
          counselorName: (counselorName || 'Counselor').trim(),
          mobile: mobileIdx !== -1 && row[mobileIdx] ? String(row[mobileIdx]).trim() : '-',
          parentContact: parentIdx !== -1 && row[parentIdx] ? String(row[parentIdx]).trim() : '-',
          address: addressIdx !== -1 && row[addressIdx] ? String(row[addressIdx]).trim() : 'Campus / Hostel'
        },
        { upsert: true }
      );
      count++;
    }

    res.json({ success: true, message: `Successfully registered ${count} students!`, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Fetch passes (filterable by status, department, section, or batch)
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

// 1. Student submits leave request
app.post('/api/apply-pass', async (req, res) => {
  try {
    const { rollNo, reason } = req.body;
    const cleanRollNo = (rollNo || '').trim();
    if (!cleanRollNo || !reason) return res.status(400).json({ success: false, message: "Roll number and reason required." });

    const student = await Student.findOne({ rollNo: cleanRollNo });
    if (!student) return res.status(404).json({ success: false, message: "Student record not found in database." });

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
    res.json({ success: true, message: `Leave submitted! Forwarded to ${student.counselorName}.`, pass: newPass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Counselor verification
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
      time: getISTTimeString()
    };
    await pass.save();
    res.json({ success: true, message: 'Verified by Counselor. Forwarded to Class Advisor.', pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Class Advisor verification
app.post('/api/approve/advisor', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    pass.status = 'Pending HOD';
    pass.advisorApproval = { approved: true, time: getISTTimeString() };
    await pass.save();
    res.json({ success: true, message: 'Approved by Class Advisor. Forwarded to HOD.', pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. HOD verification
app.post('/api/approve/hod', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    pass.status = 'Pending Principal';
    pass.hodApproval = { approved: true, time: getISTTimeString() };
    await pass.save();
    res.json({ success: true, message: 'Approved by HOD. Forwarded to Principal / Admin.', pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Principal / Admin Final Approval (Starts 20-minute countdown)
app.post('/api/approve/principal', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    const now = new Date();
    pass.status = 'Approved';
    pass.principalApproval = { approved: true, time: getISTTimeString(now) };
    pass.approvalTime = getISTTimeString(now);
    pass.expiresAt = new Date(now.getTime() + 20 * 60 * 1000); // 20-minute expiry
    await pass.save();
    res.json({ success: true, message: 'Principal approval granted! 20-minute gate pass activated.', pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Security gate optical scan verification
app.post('/api/scan-pass', async (req, res) => {
  try {
    const cleanRollNo = (req.body.rollNo || '').trim();
    const pass = await Pass.findOne({ rollNo: cleanRollNo, status: 'Approved' }).sort({ createdAt: -1 });

    if (!pass) return res.status(400).json({ success: false, message: `No active pass found for ID: ${cleanRollNo}` });

    const now = new Date();
    if (now > pass.expiresAt) {
      pass.status = 'Expired';
      await pass.save();
      return res.status(400).json({ success: false, message: 'Pass EXPIRED! 20-minute validity window ended.' });
    }

    pass.status = 'Exited';
    pass.exitTime = getISTTimeString(now);
    if (req.body.photo) pass.photo = req.body.photo;
    await pass.save();

    res.json({ success: true, pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 6. SERVER START & KEEP-ALIVE ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 GateMatrix running on port ${PORT}`));

// Keep-alive heartbeat (every 10 minutes)
setInterval(() => {
  https.get('https://gate-pass-app-t0gq.onrender.com/api/students/count', (res) => {
    console.log('[Ping] Status:', res.statusCode);
  }).on('error', () => {});
}, 10 * 60 * 1000);
