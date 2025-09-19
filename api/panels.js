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
    // Pastikan userId & serverId adalah number
    const uid = Number(userId);
    const sid = Number(serverId);

    if (!email || isNaN(uid) || isNaN(sid)) {
      console.log('[findPanelOwner] Input tidak valid:', { email, userId, serverId });
      return null;
    }

    console.log('[findPanelOwner] Mencari pemilik panel:', { email, userId: uid, serverId: sid });

    // Cari user langsung dari email
    const userDoc = await db.collection('users').doc(email).get();
    if (!userDoc.exists) {
      console.log('[findPanelOwner] User tidak ditemukan dengan email:', email);
      return null;
    }

    // Cari panel berdasarkan serverId di subcollection user (doc() harus string)
    const panelDoc = await userDoc.ref.collection('panels').doc(String(sid)).get();
    if (!panelDoc.exists) {
      console.log('[findPanelOwner] Panel tidak ditemukan untuk serverId:', sid);
      return null;
    }

    // Validasi userId panel
    const panelData = panelDoc.data();
    if (Number(panelData.userId) !== uid) {
      console.log('[findPanelOwner] UserId tidak cocok. Panel userId:', panelData.userId, 'Expected:', uid);
      return null;
    }

    console.log('[findPanelOwner] Pemilik valid:', { email, userId: uid, serverId: sid });
    return { email, userId: uid, serverId: sid }; // return tiga data

  } catch (err) {
    console.error('[findPanelOwner] Error:', err.message || err);
    throw new Error('Gagal mencari pemilik panel: ' + (err.message || 'Unknown error'));
  }
}

// ===== User API =====
async function addOrUpdateUser({ email, password, activeDays, role, money }) {
  try {
    if (!email) throw new Error('Email wajib diisi');

    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    const now = Date.now();

    // USER BARU → semua field wajib
    if (!userDoc.exists) {
      if (!password) throw new Error('Password wajib diisi untuk user baru');
      if (!activeDays || activeDays <= 0) throw new Error('activeDays wajib > 0 untuk user baru');

      const expireAt = admin.firestore.Timestamp.fromDate(new Date(now + activeDays * 86400000));

      await userRef.set({
        email,
        password,
        role: role || 'user',
        money: money || 0,
        expireAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return { email, expireAt: expireAt.toDate(), role: role || 'user', money: money || 0, action: 'added' };
    }

    // USER EXISTING → update fleksibel
    const data = userDoc.data();
    const currentExpire = data.expireAt?.toDate().getTime() || now;
    const msDays = activeDays && activeDays > 0 ? activeDays * 86400000 : 0;
    const newExpire = msDays > 0 ? new Date(Math.max(currentExpire, now) + msDays) : data.expireAt.toDate();

    const updateData = {};
    if (password) updateData.password = password;
    if (role) updateData.role = role;
    if (money !== undefined) updateData.money = money;
    if (msDays > 0) updateData.expireAt = admin.firestore.Timestamp.fromDate(newExpire);

    if (Object.keys(updateData).length > 0) {
      await userRef.update(updateData);
      return {
        email,
        expireAt: newExpire,
        role: updateData.role || data.role,
        money: updateData.money ?? data.money,
        action: 'updated'
      };
    } else {
      return {
        email,
        expireAt: data.expireAt.toDate(),
        role: data.role,
        money: data.money,
        action: 'unchanged'
      };
    }
  } catch (err) {
    throw new Error('Gagal menambahkan / memperbarui user: ' + (err.message || 'Unknown error'));
  }
}
async function getUser(email) {
  try {
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) throw new Error('User tidak ditemukan');
    const data = userDoc.data();
    const expireAt = data.expireAt?.toDate ? data.expireAt.toDate() : data.expireAt;
    const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt;
    const panelsSnapshot = await userRef.collection('panels').get();
    const panels = panelsSnapshot.docs.map(doc => {
      const panelData = doc.data();
      return {
        id: doc.id,
        ...panelData,
        createdAt: panelData.createdAt?.toDate ? panelData.createdAt.toDate() : panelData.createdAt
      };
    });
    return {
      email: data.email,
      password: data.password,
      role: data.role || 'user',
      money: data.money || 0,
      expireAt,
      createdAt,
      panels
    };
  } catch (err) {
    throw new Error('Gagal mengambil data user: ' + (err.message || 'Unknown error'));
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
async function getAllUserEmails(adminEmail) {
  try {
    if (!adminEmail) throw new Error('Email admin diperlukan');
    const adminRef = db.collection('users').doc(adminEmail);
    const adminDoc = await adminRef.get();
    if (!adminDoc.exists) throw new Error('Admin tidak ditemukan');
    const adminData = adminDoc.data();
    if (adminData.role !== 'admin') throw new Error('Akses ditolak: user bukan admin');
    const usersSnapshot = await db.collection('users').get();
    if (usersSnapshot.empty) return [];
    const emails = usersSnapshot.docs.map(doc => doc.data().email).filter(Boolean);
    return emails;
  } catch (err) {
    throw new Error('Gagal mengambil email user: ' + (err.message || 'Unknown error'));
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
async function checkAdmin(email) {
  const adminRef = db.collection('users').doc(email);
  const adminDoc = await adminRef.get();
  if (!adminDoc.exists) {
    throw new Error('User admin tidak ditemukan');
  }

  const adminData = adminDoc.data();
  if (!adminData.role || adminData.role !== 'admin') {
    throw new Error('Email yang diberikan bukan admin');
  }

  return true;
}
async function deleteAllPanels() {
  const usersSnapshot = await db.collection('users').get();
  if (usersSnapshot.empty) {
    console.log('Tidak ada user untuk diproses');
    return { deletedCount: 0 };
  }

  const batchSize = 500;
  let deletedCount = 0;

  for (const userDoc of usersSnapshot.docs) {
    const panelsSnapshot = await userDoc.ref.collection('panels').get();
    if (panelsSnapshot.empty) continue;

    for (let i = 0; i < panelsSnapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = panelsSnapshot.docs.slice(i, i + batchSize);
      batchDocs.forEach(panelDoc => batch.delete(panelDoc.ref));
      await batch.commit();
      deletedCount += batchDocs.length;
    }
  }

  console.log('Semua panel berhasil dihapus. Total panel terhapus:', deletedCount);
  return { deletedCount };
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
  if (method !== 'POST') 
    return res.status(405).json({ error: 'Method POST diperlukan' });

  const { email, password, activeDays, role, money } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Field email wajib diisi' });
  }

  // validasi jika dikirim
  if (activeDays != null && (typeof activeDays !== 'number' || activeDays <= 0)) {
    return res.status(400).json({ error: 'activeDays harus berupa angka positif' });
  }

  if (money != null && (typeof money !== 'number' || money < 0)) {
    return res.status(400).json({ error: 'money harus berupa angka positif atau 0' });
  }

  // panggil addOrUpdateUser
  const user = await addOrUpdateUser({ email, password, activeDays, role, money });

  return res.json({
    message: `User berhasil ${user.action}`,
    user
  });
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
      user_info_all: async () => {
        if (method !== 'GET') return res.status(405).json({ error: 'Method GET diperlukan' });
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: 'Email wajib diisi' });
        const emails = await getAllUserEmails(email);
        if (!emails.length) return res.status(404).json({ error: 'Tidak ada user' });
        return res.json({ emails });
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
      panel_health: async () => {
  if (method !== 'GET') return res.status(405).json({ error: 'Method GET diperlukan' });

  try {
    const response = await axios.get(
  'https://api-yudzxml.koyeb.app/api/panelHandler/health',
  {
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://resellerpanelku.x-server.web.id"
    },
    timeout: 10000
  }
);

    return res.json({
      active: response.data.active,
      maintenance: response.data.maintenance
    });
   } catch (err) {
    console.error('Health action failed:', err.message);
    return res.json({ active: false, maintenance: true });
      }
     },
      panel_create: async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method POST diperlukan' });

  const { email, username, password, ram } = req.body;

  if (!email || !username || !password || !ram) {
    return res.status(400).json({ error: 'Field email, username, password, dan ram wajib diisi' });
  }

  let deducted = 0;

  try {
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();

    if (!userDoc.exists) return res.status(404).json({ error: 'Email tidak terdaftar' });

    const userData = userDoc.data();
    const expireDate = userData.expireAt?.toDate ? userData.expireAt.toDate() : new Date(userData.expireAt);

    if (expireDate && expireDate < new Date()) {
      return res.status(403).json({ error: 'Akun Kamu sudah expired' });
    }

    if (userData.role !== 'admin') {
      if (!userData.money || userData.money < 3000) {
        return res.status(402).json({ error: 'Saldo tidak cukup untuk membuat panel', required: 3000, current: userData.money || 0 });
      }
      await userRef.update({ money: userData.money - 3000 });
      deducted = 3000;
    }

    const panelsSnapshot = await userRef.collection('panels')
      .where('username', '==', username)
      .get();

    if (!panelsSnapshot.empty) {
      if (deducted > 0) await userRef.update({ money: userData.money });
      return res.status(409).json({ error: 'Panel dengan username ini sudah ada' });
    }

    const panelData = await createPanelAPI({ ram, username, password });

    if (!panelData?.serverId) {
      if (deducted > 0) await userRef.update({ money: userData.money });
      return res.status(500).json({ error: 'Server API tidak mengembalikan serverId' });
    }

    await userRef.collection('panels').doc(String(panelData.serverId)).set({
      ...panelData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ message: 'Panel berhasil dibuat', panel: panelData });

  } catch (err) {
    if (deducted > 0) {
      try {
        const userRef = db.collection('users').doc(email);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        await userRef.update({ money: userData.money + deducted });
      } catch {}
    }
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
      panel_delete_all: async () => {
      try {
    if (method !== 'DELETE') {
      return res.status(405).json({ error: 'Method DELETE diperlukan' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Field email wajib diisi' });
    }

    // Cek role admin
    await checkAdmin(email);

    // Hapus semua panel
    const result = await deleteAllPanels();

    return res.json({ message: `Semua panel berhasil dihapus oleh admin ${email}`, deletedCount: result.deletedCount });

  } catch (err) {
    console.error('panel_delete_all Error:', err.message || err);
    return res.status(500).json({ error: err.message || 'Terjadi kesalahan pada server' });
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