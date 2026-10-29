// Criptografa os dados que já estavam no banco em texto puro. Seguro para rodar mais de uma vez.
// Uso: npm run encrypt-data   (precisa de DATABASE_URL e DATA_KEY no ambiente ou em server/.env)
try { process.loadEnvFile(require('path').join(__dirname, '.env')); } catch { /* usa o ambiente */ }
const { pool } = require('./db');
const { FIELDS, encrypt, isEncrypted, loadKey } = require('./crypto');

(async () => {
    loadKey();
    let total = 0;
    for (const [table, cols] of Object.entries(FIELDS)) {
        const { rows } = await pool.query(`SELECT id, ${cols.join(', ')} FROM ${table}`);
        for (const row of rows) {
            const changes = cols.filter(c => row[c] && !isEncrypted(row[c]));
            if (!changes.length) continue;
            await pool.query(
                `UPDATE ${table} SET ${changes.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${changes.length + 1}`,
                [...changes.map(c => encrypt(row[c], `${table}.${c}`)), row.id]
            );
            total++;
        }
    }
    console.log(`${total} registro(s) criptografado(s).`);
    await pool.end();
})().catch(err => { console.error(err.message); process.exit(1); });
