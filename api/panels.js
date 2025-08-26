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
  try {
    console.log('[createPanelAPI] Membuat panel:', { ram, username });
    const res = await axios.post(`${API_BASE}/create-panel`, { ram, username, password }, {
      headers: { "Content-Type": "application/json", "Origin": "https://resellerpanelku.x-server.web.id" }
    });
    console.log('[createPanelAPI] Response:', res.data);
    return res.data;
  } catch (err) {
    console.error('[createPanelAPI] Error:', err.message || err);
    throw new Error('Gagal membuat panel: ' + (err.message || 'Unknown error'));
  }
}

async function deletePanelAPI({ userId, serverId }) {
  try {
    console.log('[deletePanelAPI] Menghapus panel:', { userId, serverId });
    const res = await axios.post(`${API_BASE}/delete-panel`, { userId, serverId }, {
      headers: { "Content-Type": "application/json", "Origin": "https://resellerpanelku.x-server.web.id" }
    });
    console.log('[deletePanelAPI] Response:', res.data);
    return res.data;
  } catch (err) {
    console.error('[deletePanelAPI] Error:', err.message || err);
    throw new Error('Gagal menghapus panel: ' + (err.message || 'Unknown error'));
  }
}

async function getCurrentPanels(email) {
  try {
    console.log('[getCurrentPanels] Mengambil panel untuk email:', email);
    const snapshot = await db.collection('users').doc(email).collection('panels').get();
    if (snapshot.empty) {
      console.log('[getCurrentPanels] Tidak ada panel ditemukan');
      return [];
    }
    const panels = [];
    snapshot.forEach(doc => {
      panels.push({ id: doc.id, ...doc.data() });
    });
    console.log('[getCurrentPanels] Panels ditemukan:', panels.length);
    return panels;
  } catch (err) {
    console.error('[getCurrentPanels] Error:', err.message || err);
    throw new Error('Gagal mengambil panels: ' + (err.message || 'Unknown error'));
  }
}

async function findPanelOwner(email, userId, serverId) {
  try {
    console.log('[findPanelOwner] Mencari pemilik panel:', { email, userId, serverId });

    // Cari user langsung dari email
    const userDoc = await db.collection('users').doc(email).get();
    if (!userDoc.exists) {
      console.log('[findPanelOwner] User tidak ditemukan dengan email:', email);
      return null;
    }

    // Cari panel berdasarkan serverId di subcollection user
    const panelDoc = await userDoc.ref.collection('panels').doc(serverId).get();
    if (!panelDoc.exists) {
      console.log('[findPanelOwner] Panel tidak ditemukan untuk serverId:', serverId);
      return null;
    }

    // Validasi userId panel
    const panelData = panelDoc.data();
    if (panelData.userId !== userId) {
      console.log('[findPanelOwner] UserId tidak cocok. Panel userId:', panelData.userId, 'Expected:', userId);
      return null;
    }

    console.log('[findPanelOwner] Pemilik valid:', { email, userId, serverId });
    return { email, userId, serverId }; // return tiga data
  } catch (err) {
    console.error('[findPanelOwner] Error:', err.message || err);
    throw new Error('Gagal mencari pemilik panel: ' + (err.message || 'Unknown error'));
  }
}

// ===== User API =====
async function addOrUpdateUser({ email, password, activeDays, role = 'user' }) {
  try {
    console.log('[addOrUpdateUser] Menambahkan / memperbarui user:', { email, activeDays, role });
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
      console.log('[addOrUpdateUser] User baru dibuat:', email);
      return { email, expireAt: expireAt.toDate(), role, action: 'added' };
    } else {
      const data = userDoc.data();
      const currentExpire = data.expireAt.toDate().getTime();
      const newExpire = new Date(Math.max(currentExpire, now) + msDays);
      await userRef.update({ password, expireAt: admin.firestore.Timestamp.fromDate(newExpire), role });
      console.log('[addOrUpdateUser] User diperbarui:', email);
      return { email, expireAt: newExpire, role, action: 'updated' };
    }
  } catch (err) {
    console.error('[addOrUpdateUser] Error:', err.message || err);
    throw new Error('Gagal menambahkan / memperbarui user: ' + (err.message || 'Unknown error'));
  }
}

async function deleteUser(email) {
  try {
    console.log('[deleteUser] Menghapus user:', email);
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('User tidak ditemukan');
    await userRef.delete();
    console.log('[deleteUser] User berhasil dihapus:', email);
    return { email };
  } catch (err) {
    console.error('[deleteUser] Error:', err.message || err);
    throw new Error('Gagal menghapus user: ' + (err.message || 'Unknown error'));
  }
}

async function getUser(email) {
  try {
    console.log('[getUser] Mengambil data user:', email);
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('User tidak ditemukan');
    const data = userDoc.data();
    console.log('[getUser] Data user ditemukan:', data);
    return { 
      email: data.email, 
      password: data.password,
      role: data.role || 'user', 
      expireAt: data.expireAt.toDate(), 
      createdAt: data.createdAt.toDate() 
    };
  } catch (err) {
    console.error('[getUser] Error:', err.message || err);
    throw new Error('Gagal mengambil data user: ' + (err.message || 'Unknown error'));
  }
}

async function updateUserRole(email, role) {
  try {
    console.log('[updateUserRole] Mengubah role user:', { email, role });
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('User tidak ditemukan');
    await userRef.update({ role });
    console.log('[updateUserRole] Role user berhasil diubah:', email);
    return { email, role };
  } catch (err) {
    console.error('[updateUserRole] Error:', err.message || err);
    throw new Error('Gagal mengubah role user: ' + (err.message || 'Unknown error'));
  }
}

// ===== Handler =====
module.exports = async function handler(req, res) {
  try {
    const method = req.method;
    const action = req.body?.action || req.query?.action;

    if (!action) {
      return res.status(400).json({ error: 'Action tidak diberikan' });
    }

    // ========================= ACTION HANDLERS =========================
    const actions = {
      // ------------------- USER ACTIONS -------------------
      user_add: async () => {
        if (method !== 'POST') return res.status(405).json({ error: 'Method POST diperlukan' });

        const { email, password, activeDays, role } = req.body;
        if (!email || !password || activeDays == null) {
          return res.status(400).json({ error: 'Field email, password, dan activeDays wajib diisi' });
        }
        if (typeof activeDays !== 'number' || activeDays <= 0) {
          return res.status(400).json({ error: 'activeDays harus berupa angka positif' });
        }

        const user = await addOrUpdateUser({ email, password, activeDays, role });
        return res.json({ message: `User berhasil ${user.action}`, user });
      },

      user_delete: async () => {
        if (method !== 'DELETE') return res.status(405).json({ error: 'Method DELETE diperlukan' });
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

        const user = await deleteUser(email);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        return res.json({ message: 'User berhasil dihapus', user });
      },

      user_info: async () => {
        if (method !== 'GET') return res.status(405).json({ error: 'Method GET diperlukan' });
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

        const user = await getUser(email);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        return res.json({ user });
      },

      user_role: async () => {
        if (method !== 'POST') return res.status(405).json({ error: 'Method POST diperlukan' });
        const { email, role } = req.body;
        if (!email || !role) return res.status(400).json({ error: 'Field email dan role wajib diisi' });

        const user = await updateUserRole(email, role);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        return res.json({ message: 'Role user berhasil diubah', user });
      },

      // ------------------- PANEL ACTIONS -------------------
      panel_create: async () => {
  if (method !== 'POST') return res.status(405).json({ error: 'Method POST diperlukan' });
  const { email, username, password, ram } = req.body;
  if (!email || !username || !password || !ram) return res.status(400).json({ error: 'Field email, username, password, dan ram wajib diisi' });

  try {
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: 'Email tidak terdaftar' });

    const panelData = await createPanelAPI({ ram, username, password });
    if (!panelData?.serverId) return res.status(500).json({ error: 'Server API tidak mengembalikan serverId' });

    await userRef.collection('panels').doc(String(panelData.serverId)).set({
      ...panelData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ message: 'Panel berhasil dibuat', panel: panelData });

  } catch (err) {
    return res.status(500).json({ error: 'Gagal membuat panel: ' + (err.message || 'Unknown error') });
  }
},

      panel_delete: async () => {
  try {
    if (method !== 'DELETE') {
      return res.status(405).json({ error: 'Method DELETE diperlukan' });
    }

    const { email, userId, serverId } = req.body;
    if (!email || !userId || !serverId) {
      return res.status(400).json({ error: 'Field email, userId, dan serverId wajib diisi' });
    }

    // Pastikan userId & serverId adalah number
    const uid = Number(userId);
    const sid = Number(serverId);
    if (isNaN(uid) || isNaN(sid)) {
      return res.status(400).json({ error: 'userId dan serverId harus angka' });
    }

    const owner = await findPanelOwner(email, uid, sid);
    if (!owner) {
      return res.status(404).json({ error: 'Panel tidak ditemukan atau tidak cocok' });
    }

    // Hapus panel dari API
    await deletePanelAPI({ userId: uid, serverId: sid });

    // Hapus panel di Firestore (doc() harus string)
    await db.collection('users')
      .doc(owner.email)
      .collection('panels')
      .doc(String(owner.serverId))
      .delete();

    return res.json({ message: 'Panel berhasil dihapus' });

  } catch (err) {
    console.error('Handler Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server' });
  }
},

      panel_current: async () => {
        if (method !== 'GET') return res.status(405).json({ error: 'Method GET diperlukan' });
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

        const panels = await getCurrentPanels(email);
        return res.json({ panels });
      }
    };

    // ========================= EXECUTE ACTION =========================
    if (actions[action]) {
      return await actions[action]();
    } else {
      return res.status(404).json({ error: `Action "${action}" tidak ditemukan` });
    }
  } catch (err) {
    console.error('Handler Error:', err);
    return res.status(500).json({ error: err?.message || 'Terjadi kesalahan internal server' });
  }
};