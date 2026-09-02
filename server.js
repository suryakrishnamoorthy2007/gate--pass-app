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

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:AdminPass123@cluster0.gpgplkf.mongodb.net/gatepass?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

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

function extractSection(val) {
  if (!val) return '';
  const clean = String(val).trim().toLowerCase();
  const match = clean.match(/[a-z]$/i) || clean.match(/(?:sec|section)[^a-z0-9]*([a-z])/i);
  return match ? match[1] : clean.replace(/[^a-z0-9]/g, '');
}

// Clean numeric extractor for comparing roll ranges
function extractRollNumber(val) {
  if (!val) return 0n;
  const digits = String(val).replace(/\D/g, '');
  return digits ? BigInt(digits) : 0n;
}

// AI Formal Letter Engine
function generateFormalLetter(student, rawReason) {
  const currentDate = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  return `FORMAL LEAVE & INSTITUTIONAL OUTPASS APPLICATION

Date: ${currentDate}

From:
${student.name}
Roll Number: ${student.rollNo}
Department: ${student.dept} | Class/Section: ${student.yearSec || 'A'}
Student Contact: ${student.mobile || '-'} | Parent Contact: ${student.parentContact || '-'}

Through:
1. Assigned Class Counselor (${student.counselorName || 'Counselor'})
2. Respective Class Advisor
3. Head of the Department (HOD)

To:
The Principal / Executive Directorate,
Institutional Campus Administration.

Respected Sir/Madam,

Subject: Requisition for authorized institutional leave / campus gate clearance - reg.

I am writing this formal application to humbly submit that I require permission to leave the campus premises due to the following necessity:

"${rawReason.trim()}"

I have duly informed my parents regarding this leave requirement, and they can be contacted at ${student.parentContact || '-'} for direct telephonic verification. I undertake that I will adhere to all institutional guidelines and complete any missed academic coursework immediately upon my return.

Kindly grant me the requisite clearance and approve my gate pass for the aforementioned period.

Yours obediently,
${student.name}
(Roll No: ${student.rollNo})`;
}

// Schemas
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, required: true },
  dept: { type: String, default: 'CSE' },
  yearSec: { type: String, default: 'A' },
  startRoll: { type: String, default: '' }, // Starting roll number assigned to counselor
  endRoll: { type: String, default: '' },   // Ending roll number assigned to counselor
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const StudentSchema = new mongoose.Schema({
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, required: true },
  yearSec: { type: String, default: 'A' },
  counselorName: { type: String, default: 'Class Counselor' },
  mobile: { type: String, default: '-' },
  parentContact: { type: String, required: true },
  email: { type: String, default: '-' },
  address: { type: String, default: 'Campus Hostel' }
});
const Student = mongoose.model('Student', StudentSchema);

const PassSchema = new mongoose.Schema({
  rollNo: { type: String, required: true },
  name: String,
  dept: String,
  yearSec: String,
  counselorName: String,
  mobile: String,
  parentContact: String,
  email: String,
  address: String,
  reason: { type: String, required: true },
  formalLetter: { type: String, default: '' },
  
  status: {
    type: String,
    enum: ['Pending Counselor', 'Pending Advisor', 'Pending HOD', 'Pending Principal', 'Approved', 'Exited', 'Expired', 'Rejected'],
    default: 'Pending Counselor'
  },

  parentCalledBy: { type: String, default: '-' },
  parentCallVerified: { type: Boolean, default: false },
  parentCallTime: { type: String, default: '-' },

  counselorApproval: { counselorName: String, approved: { type: Boolean, default: false }, time: String },
  advisorApproval: { advisorName: String, approved: { type: Boolean, default: false }, time: String },
  hodApproval: { approved: { type: Boolean, default: false }, time: String },
  principalApproval: { approved: { type: Boolean, default: false }, time: String },

  approvalTime: String,
  validUntil: String,
  expiresAt: Date,
  exitStatus: { type: String, default: 'Inside Campus' },
  exitTime: { type: String, default: '-' },
  createdAt: { type: Date, default: Date.now }
});
const Pass = mongoose.model('Pass', PassSchema);

// Auth Register (Includes startRoll & endRoll for Counselors)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { userId, name, password, role, dept, yearSec, startRoll, endRoll } = req.body;
    const cleanId = (userId || '').trim().toLowerCase();

    const existing = await User.findOne({ userId: cleanId });
    if (existing) return res.status(400).json({ success: false, message: 'User already exists. Please login.' });

    const newUser = new User({
      userId: cleanId,
      name: name.trim(),
      password: password.trim(),
      role,
      dept: (dept || 'CSE').trim().toUpperCase(),
      yearSec: (yearSec || 'A').trim().toUpperCase(),
      startRoll: (startRoll || '').trim(),
      endRoll: (endRoll || '').trim()
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

// Excel Roster Upload
app.post('/api/upload-students', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Please select an Excel file" });
    const { dept, yearSec, counselorName } = req.body;

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' });

    let headerIdx = rows.findIndex(r => r.some(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, '').includes('roll')));
    if (headerIdx === -1) headerIdx = 0;

    const rawHeaders = rows[headerIdx].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const getCol = (keys) => rawHeaders.findIndex(h => keys.some(k => h.includes(k)));

    const rollIdx = getCol(['roll', 'reg', 'id']);
    const nameIdx = getCol(['name', 'studentname']);
    const secIdx = getCol(['sec', 'section', 'class']);
    const mobileIdx = getCol(['studentphone', 'studentmobile', 'mobile', 'phone']);
    const parentIdx = getCol(['parent', 'father', 'guardian']);
    const emailIdx = getCol(['email', 'mail']);
    const addrIdx = getCol(['address', 'hostel', 'city', 'location']);

    let count = 0;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      let rollNo = rollIdx !== -1 && row[rollIdx] ? String(row[rollIdx]).trim() : '';
      if (!rollNo || rollNo.toLowerCase().includes('roll')) continue;

      const finalSec = (secIdx !== -1 && row[secIdx]) ? String(row[secIdx]).trim() : (yearSec || 'A');

      await Student.findOneAndUpdate(
        { rollNo },
        {
          rollNo,
          name: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : 'Student',
          dept: (dept || 'CSE').trim().toUpperCase(),
          yearSec: finalSec.toUpperCase(),
          counselorName: (counselorName || 'Counselor').trim(),
          mobile: mobileIdx !== -1 && row[mobileIdx] ? String(row[mobileIdx]).trim() : '-',
          parentContact: parentIdx !== -1 && row[parentIdx] ? String(row[parentIdx]).trim() : '-',
          email: emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).trim() : '-',
          address: addrIdx !== -1 && row[addrIdx] ? String(row[addrIdx]).trim() : 'Campus Hostel'
        },
        { upsert: true }
      );
      count++;
    }
    res.json({ success: true, message: `Successfully registered ${count} students for counselor ${counselorName}!`, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PASSES API: ROLE ACCESS CONTROL (WITH COUNSELOR ROLL RANGE CHECK)
app.get('/api/passes', async (req, res) => {
  try {
    const { status, dept, rollNo, counselorName, yearSec, role, startRoll, endRoll } = req.query;
    let filter = {};

    if (status) filter.status = status;
    if (rollNo) filter.rollNo = rollNo.trim();

    // HOD: department-wide
    if (role === 'hod' || (dept && !yearSec && role !== 'principal' && role !== 'counselor')) {
      filter.dept = dept.toUpperCase().trim();
    }
    // ADVISOR: department + section
    else if (role === 'advisor') {
      filter.dept = dept.toUpperCase().trim();
    }

    let passes = await Pass.find(filter).sort({ createdAt: -1 });

    // 1. COUNSELOR FILTERING (Matches startRoll to endRoll OR counselorName)
    if (role === 'counselor') {
      const sVal = extractRollNumber(startRoll);
      const eVal = extractRollNumber(endRoll);

      passes = passes.filter(p => {
        // Direct counselor name match
        if (counselorName && p.counselorName && p.counselorName.toLowerCase() === counselorName.toLowerCase().trim()) {
          return true;
        }
        // Roll range match
        if (sVal > 0n && eVal > 0n) {
          const sNum = extractRollNumber(p.rollNo);
          return sNum >= sVal && sNum <= eVal;
        }
        return false;
      });
    }

    // 2. ADVISOR FILTERING (Strict Section isolation: CSE-A never sees CSE-B)
    if (role === 'advisor' && yearSec) {
      const targetSec = extractSection(yearSec);
      passes = passes.filter(p => extractSection(p.yearSec) === targetSec);
    }

    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply Pass (Auto-assigns Counselor using roll number range)
app.post('/api/apply-pass', async (req, res) => {
  try {
    const { rollNo, reason } = req.body;
    const cleanRoll = (rollNo || '').trim();
    let student = await Student.findOne({ rollNo: cleanRoll });

    // Find the counselor who registered this roll range if student not in roster yet
    let assignedCounselor = student ? student.counselorName : 'Counselor';
    if (!student || assignedCounselor === 'Class Counselor' || assignedCounselor === 'Counselor') {
      const rollBig = extractRollNumber(cleanRoll);
      const counselors = await User.find({ role: 'counselor' });
      for (const c of counselors) {
        const sVal = extractRollNumber(c.startRoll);
        const eVal = extractRollNumber(c.endRoll);
        if (sVal > 0n && eVal > 0n && rollBig >= sVal && rollBig <= eVal) {
          assignedCounselor = c.name;
          break;
        }
      }
    }

    const studentObj = student || {
      rollNo: cleanRoll,
      name: 'Student',
      dept: 'CSE',
      yearSec: 'A',
      counselorName: assignedCounselor,
      mobile: '-',
      parentContact: '-',
      email: '-',
      address: 'Campus Hostel'
    };

    const generatedLetter = generateFormalLetter(studentObj, reason);

    const newPass = new Pass({
      rollNo: studentObj.rollNo,
      name: studentObj.name,
      dept: studentObj.dept,
      yearSec: studentObj.yearSec,
      counselorName: assignedCounselor,
      mobile: studentObj.mobile,
      parentContact: studentObj.parentContact,
      email: studentObj.email,
      address: studentObj.address,
      reason: reason.trim(),
      formalLetter: generatedLetter,
      status: 'Pending Counselor',
      exitStatus: 'Inside Campus',
      exitTime: '-'
    });

    await newPass.save();
    res.json({ success: true, message: `Pass applied! Routed to Counselor (${assignedCounselor}).` });
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
    pass.parentCallVerified = !!parentCalled;
    pass.parentCalledBy = 'Counselor (' + (counselorName || 'Assigned Counselor') + ')';
    pass.parentCallTime = getISTTimeString();
    pass.counselorApproval = {
      counselorName: counselorName || 'Counselor',
      approved: true,
      time: getISTTimeString()
    };
    await pass.save();
    res.json({ success: true, message: 'Verified by Counselor & forwarded to Class Advisor.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Class Advisor Approval
app.post('/api/approve/advisor', async (req, res) => {
  try {
    const { passId, advisorName, parentCalledFallback } = req.body;
    const pass = await Pass.findById(passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    if (!pass.parentCallVerified && parentCalledFallback) {
      pass.parentCallVerified = true;
      pass.parentCalledBy = 'Class Advisor (' + (advisorName || 'Advisor') + ') [Counselor Absent]';
      pass.parentCallTime = getISTTimeString();
    }

    if (!pass.parentCallVerified) {
      return res.status(400).json({ success: false, message: 'Parent must be contacted before forwarding to HOD!' });
    }

    pass.status = 'Pending HOD';
    pass.advisorApproval = {
      advisorName: advisorName || 'Class Advisor',
      approved: true,
      time: getISTTimeString()
    };
    await pass.save();
    res.json({ success: true, message: 'Approved by Class Advisor & forwarded to HOD.' });
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
    res.json({ success: true, message: 'HOD authorized! Forwarded to Principal for final clearance.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Principal Approval
app.post('/api/approve/principal', async (req, res) => {
  try {
    const pass = await Pass.findById(req.body.passId);
    if (!pass) return res.status(404).json({ success: false, message: 'Pass not found' });

    const now = new Date();
    const expiry = new Date(now.getTime() + 20 * 60 * 1000);

    pass.status = 'Approved';
    pass.principalApproval = { approved: true, time: getISTTimeString(now) };
    pass.approvalTime = getISTTimeString(now);
    pass.validUntil = getISTTimeString(expiry);
    pass.expiresAt = expiry;
    await pass.save();
    res.json({ success: true, message: 'Principal approval granted! 20-minute gate validity started.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Security Gate Scan
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
    pass.exitTime = getISTTimeString(now);
    await pass.save();

    res.json({ success: true, pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 GateMatrix running on port ${PORT}`));

setInterval(() => {
  https.get('https://gate-pass-app-t0gq.onrender.com/api/passes', () => {}).on('error', () => {});
}, 10 * 60 * 1000);
