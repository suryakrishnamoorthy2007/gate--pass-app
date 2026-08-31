const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(__dirname));

// --- 1. MONGODB ATLAS CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:AdminPass123@cluster0.gpgplkf.mongodb.net/gatepass?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- IST DATE & TIME FORMATTER HELPER ---
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

// --- 2. SCHEMAS ---
const StudentSchema = new mongoose.Schema({
  rollNo: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, default: 'General' },
  year: { type: String, default: 'III' },
  sec: { type: String, default: 'A' },
  yearSec: { type: String, default: 'III / A' },
  mobile: { type: String, default: '-' },
  parentContact: { type: String, default: '-' },
  email: { type: String, default: '-' },
  address: { type: String, default: '-' }
});
const Student = mongoose.model('Student', StudentSchema);

const PassSchema = new mongoose.Schema({
  rollNo: { type: String, required: true },
  name: { type: String, default: 'Student' },
  dept: { type: String, default: 'Engineering' },
  year: { type: String, default: 'III' },
  sec: { type: String, default: 'A' },
  yearSec: { type: String, default: 'III / A' },
  mobile: { type: String, default: '-' },
  parentContact: { type: String, default: '-' },
  email: { type: String, default: '-' },
  address: { type: String, default: '-' },
  status: { type: String, default: 'Approved' },
  approvalTime: String,
  exitTime: { type: String, default: '-' },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Pass = mongoose.model('Pass', PassSchema);

// Admin Credentials
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

// --- 3. PAGE ROUTES ---
app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/security', (req, res) => res.sendFile(path.join(__dirname, 'security.html')));

// --- 4. API ENDPOINTS ---

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ success: true, token: "admin-logged-in" });
  } else {
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

// Check Student Database Count
app.get('/api/students/count', async (req, res) => {
  try {
    const count = await Student.countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk Upload Excel / CSV
app.post('/api/upload-students', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please select an Excel file" });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: "The Excel file is empty" });
    }

    let headerRowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const rowStr = rows[i].map(cell => String(cell).toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (rowStr.some(h => h.includes('roll') || h.includes('reg') || h === 'id' || h === 'rollno')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 0;

    const rawHeaders = rows[headerRowIdx].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));

    const getColIndex = (keywords) => {
      return rawHeaders.findIndex(h => keywords.some(k => h.includes(k)));
    };

    const rollIdx = getColIndex(['roll', 'reg', 'id']);
    const nameIdx = getColIndex(['name', 'studentname']);
    const deptIdx = getColIndex(['dept', 'department', 'branch']);
    const yearIdx = getColIndex(['year', 'studyingyear', 'class']);
    const secIdx = getColIndex(['sec', 'section']);
    const yearSecIdx = getColIndex(['yearsec', 'classsec']);
    const mobileIdx = getColIndex(['mobile', 'phone', 'studentmobile', 'contact']);
    const parentIdx = getColIndex(['parent', 'guardian', 'father', 'emergency']);
    const emailIdx = getColIndex(['email', 'mail']);
    const addressIdx = getColIndex(['address', 'hostel', 'place', 'city', 'location']);

    let count = 0;

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const rollNo = rollIdx !== -1 && row[rollIdx] ? String(row[rollIdx]).trim() : '';
      if (!rollNo || rollNo.toLowerCase().includes('roll') || rollNo.toLowerCase().includes('sample')) continue;

      const studentName = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : 'Student';
      const dept = deptIdx !== -1 && row[deptIdx] ? String(row[deptIdx]).trim() : 'Engineering';
      
      const year = yearIdx !== -1 && row[yearIdx] ? String(row[yearIdx]).trim() : 'III';
      const sec = secIdx !== -1 && row[secIdx] ? String(row[secIdx]).trim() : 'A';
      const yearSec = yearSecIdx !== -1 && row[yearSecIdx] ? String(row[yearSecIdx]).trim() : `${year} / ${sec}`;
      
      const mobile = mobileIdx !== -1 && row[mobileIdx] ? String(row[mobileIdx]).trim() : '-';
      const parentContact = parentIdx !== -1 && row[parentIdx] ? String(row[parentIdx]).trim() : mobile;
      const email = emailIdx !== -1 && row[emailIdx] ? String(row[emailIdx]).trim() : '-';
      const address = addressIdx !== -1 && row[addressIdx] ? String(row[addressIdx]).trim() : 'Campus / Hostel';

      await Student.findOneAndUpdate(
        { rollNo: rollNo },
        {
          rollNo: rollNo,
          name: studentName,
          dept: dept,
          year: year,
          sec: sec,
          yearSec: yearSec,
          mobile: mobile,
          parentContact: parentContact,
          email: email,
          address: address
        },
        { upsert: true }
      );
      count++;
    }

    console.log(`✅ Successfully imported ${count} student(s) into MongoDB Atlas`);
    res.json({ success: true, message: `Successfully imported ${count} student${count === 1 ? '' : 's'}!`, count: count });
  } catch (err) {
    console.error("❌ Excel Parse Error:", err);
    res.status(500).json({ success: false, message: `Error parsing file: ${err.message}` });
  }
});

// Fetch Passes for Admin Table & PDF
app.get('/api/passes', async (req, res) => {
  try {
    const passes = await Pass.find().sort({ createdAt: -1 });
    res.json(passes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Approves Pass
app.post('/api/approve-pass', async (req, res) => {
  try {
    const { rollNo } = req.body;
    const cleanRollNo = (rollNo || '').trim();

    if (!cleanRollNo) return res.status(400).json({ success: false, message: "Roll Number required" });

    let student = await Student.findOne({ rollNo: cleanRollNo });
    if (!student) {
      student = {
        name: `Student (${cleanRollNo})`,
        dept: 'Engineering',
        year: 'III',
        sec: 'A',
        yearSec: 'III / A',
        mobile: '-',
        parentContact: '-',
        email: '-',
        address: 'Campus / Hostel'
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 20 * 60 * 1000); // 20-minute validity

    const newPass = new Pass({
      rollNo: cleanRollNo,
      name: student.name,
      dept: student.dept,
      year: student.year || 'III',
      sec: student.sec || 'A',
      yearSec: student.yearSec || `${student.year || 'III'} / ${student.sec || 'A'}`,
      mobile: student.mobile,
      parentContact: student.parentContact || student.mobile,
      email: student.email,
      address: student.address,
      status: 'Approved',
      approvalTime: getISTTimeString(now),
      expiresAt: expiresAt,
      exitTime: '-'
    });

    await newPass.save();
    res.json({ success: true, pass: newPass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Security Gate Scanner (Instant pass verification)
app.post('/api/scan-pass', async (req, res) => {
  try {
    const { rollNo } = req.body;
    const cleanRollNo = (rollNo || '').trim();

    const pass = await Pass.findOne({ rollNo: cleanRollNo, status: 'Approved' }).sort({ createdAt: -1 });

    if (!pass) {
      return res.status(400).json({ success: false, message: `No active pass found for ID: ${cleanRollNo}` });
    }

    const now = new Date();
    if (now > pass.expiresAt) {
      pass.status = 'Expired';
      await pass.save();
      return res.status(400).json({ success: false, message: 'Pass EXPIRED! 20-minute validity ended.' });
    }

    const exitFormattedTime = getISTTimeString(now);
    pass.status = 'Exited';
    pass.exitTime = exitFormattedTime;
    await pass.save();

    console.log(`🚪 [GATE EXIT CONFIRMED] Student: ${pass.name} (${pass.rollNo}) at ${exitFormattedTime}`);
    res.json({ success: true, pass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Gate Pass Server running on port ${PORT}`));
