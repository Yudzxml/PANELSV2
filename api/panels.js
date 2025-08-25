const admin = require('firebase-admin');
const axios = require('axios');

const firebaseConfig = process.env.FIREBASE_CONFIG;

if (!firebaseConfig) throw new Error('FIREBASE_CONFIG environment variable tidak ditemukan!');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(firebaseConfig))
  });
}

const db = admin.firestore();
const API_BASE = 'https://api-yudzxml.koyeb.app/api/panelHandler';

// ===== Panel API =====
async function createPanelAPI({ ram, username, password }) {
  const res = await axios.post(`${API_BASE}/create-panel`, { ram, username, password }, {
    headers: { "Content-Type": "application/json", "Origin": "https://resellerpanelku.x-server.web.id" }
  });
  return res.data;
}

async function deletePanelAPI({ userId, serverId }) {
  const res = await axios.post(`${API_BASE}/delete-panel`, { userId, serverId }, {
    headers: { "Content-Type": "application/json", "Origin": "https://resellerpanelku.x-server.web.id" }
  });
  return res.data;
}

async function getCurrentPanels(email) {
  const snapshot = await db.collection('users').doc(email).collection('panels').get();
  if (snapshot.empty) return [];
  const panels = [];
  snapshot.forEach(doc => panels.push({ id: doc.id, ...doc.data() }));
  return panels;
}

async function findPanelOwner(userId, serverId) {
  const snapshot = await db.collection('users').get();
  for (const doc of snapshot.docs) {
    const panelDoc = await doc.ref.collection('panels').doc(serverId).get();
    if (panelDoc.exists && panelDoc.data().userId === userId) return doc.id;
  }
  return null;
}

// ===== User API =====
async function addOrUpdateUser({ email, password, activeDays, role = 'user' }) {
  const userRef = db.collection('users').doc(email);
  const userDoc = await userRef.get();
  const now = Date.now();
  const msDays = activeDays * 86400000;

  if (!userDoc.exists) {
    const expireAt = admin.firestore.Timestamp.fromDate(new Date(now + msDays));
    await userRef.set({ 
      email, 
      password, 
      role, 
      expireAt, 
      createdAt: admin.firestore.FieldValue.serverTimestamp() 
    });
    return { email, expireAt: expireAt.toDate(), role, action: 'added' };
  } else {
    const data = userDoc.data();
    const currentExpire = data.expireAt.toDate().getTime();
    const newExpire = new Date(Math.max(currentExpire, now) + msDays);
    await userRef.update({ password, expireAt: admin.firestore.Timestamp.fromDate(newExpire), role });
    return { email, expireAt: newExpire, role, action: 'updated' };
  }
}

async function deleteUser(email) {
  const userRef = db.collection('users').doc(email);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error('User tidak ditemukan');
  await userRef.delete();
  return { email };
}

async function getUser(email) {
  const userRef = db.collection('users').doc(email);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error('User tidak ditemukan');
  const data = userDoc.data();
  return { 
    email: data.email, 
    password: data.password,
    role: data.role || 'user', 
    expireAt: data.expireAt.toDate(), 
    createdAt: data.createdAt.toDate() 
  };
}

async function updateUserRole(email, role) {
  const userRef = db.collection('users').doc(email);
  const userDoc = await userRef.get();
  if (!userDoc.exists) throw new Error('User tidak ditemukan');
  await userRef.update({ role });
  return { email, role };
}

// ===== Handler =====
module.exports = async function handler(req, res) {
  try {
    const method = req.method;
    const action = req.body?.action || req.query?.action;

    if (!action) return res.status(400).json({ error: 'Action tidak diberikan' });

    // ========================= ACTION HANDLERS =========================
    const actions = {
      // ------------------- USER ACTIONS -------------------
      user_add: async () => {
        if (method !== 'POST') return res.status(405).json({ error: 'Method tidak diizinkan' });
        const { email, password, activeDays, role } = req.body;
        if (!email || !password || activeDays == null) return res.status(400).json({ error: 'Field tidak lengkap' });
        const user = await addOrUpdateUser({ email, password, activeDays, role });
        return res.json({ message: `User berhasil ${user.action}`, user });
      },

      user_delete: async () => {
        if (method !== 'DELETE') return res.status(405).json({ error: 'Method tidak diizinkan' });
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email diperlukan' });
        const user = await deleteUser(email);
        return res.json({ message: 'User berhasil dihapus', user });
      },

      user_info: async () => {
        if (method !== 'GET') return res.status(405).json({ error: 'Method tidak diizinkan' });
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'Email diperlukan' });
        const user = await getUser(email);
        return res.json({ user });
      },

      user_role: async () => {
        if (method !== 'POST') return res.status(405).json({ error: 'Method tidak diizinkan' });
        const { email, role } = req.body;
        if (!email || !role) return res.status(400).json({ error: 'Field tidak lengkap' });
        const user = await updateUserRole(email, role);
        return res.json({ message: 'Role user berhasil diubah', user });
      },

      // ------------------- PANEL ACTIONS -------------------
      panel_create: async (req, res) => {
  if (req.method !== 'POST') 
    return res.status(405).json({ error: 'Method tidak diizinkan' });

  const { email, username, password, ram } = req.body;
  if (!email || !username || !password || !ram) 
    return res.status(400).json({ error: 'Field tidak lengkap' });

  const userRef = db.collection('users').doc(email);
  const userDoc = await userRef.get();
  if (!userDoc.exists) 
    return res.status(404).json({ error: 'Email tidak terdaftar' });

  // Gunakan username yang berbeda dari email
  const panelData = await createPanelAPI({ ram, username, password });

  await userRef.collection('panels').doc(panelData.serverId).set({
    ...panelData,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return res.json({ message: 'Panel berhasil dibuat', panel: panelData });
},

      panel_delete: async () => {
        if (method !== 'DELETE') return res.status(405).json({ error: 'Method tidak diizinkan' });
        const { userId, serverId } = req.body;
        if (!userId || !serverId) return res.status(400).json({ error: 'Field tidak lengkap' });

        const emailFound = await findPanelOwner(userId, serverId);
        if (!emailFound) return res.status(404).json({ error: 'Panel tidak ditemukan' });

        await deletePanelAPI({ userId, serverId });
        await db.collection('users').doc(emailFound).collection('panels').doc(serverId).delete();
        return res.json({ message: 'Panel berhasil dihapus' });
      },

      panel_current: async () => {
        if (method !== 'GET') return res.status(405).json({ error: 'Method tidak diizinkan' });
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'Email diperlukan' });

        const panels = await getCurrentPanels(email);
        return res.json({ panels });
      }
    };

    // ========================= EXECUTE ACTION =========================
    if (actions[action]) {
      return await actions[action]();
    } else {
      return res.status(404).json({ error: 'Action tidak ditemukan' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};