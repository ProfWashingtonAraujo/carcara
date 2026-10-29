// Criptografia de campos em repouso (AES-256-GCM). Formato: enc:v1:<base64(iv[12] + texto cifrado + tag[16])>
// O contexto (tabela.coluna) entra como dado autenticado: um valor copiado para outra coluna não decifra.
// O Python (python/carcara/crypto.py) usa o mesmo formato.
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function loadKey() {
    const raw = (process.env.DATA_KEY || '').trim();
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) {
        throw new Error('DATA_KEY precisa ter 32 bytes (64 caracteres hex ou base64). Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    }
    return key;
}

let cachedKey;
const key = () => (cachedKey ??= loadKey());

const isEncrypted = v => typeof v === 'string' && v.startsWith(PREFIX);

function encrypt(value, context) {
    if (value === null || value === undefined || value === '' || isEncrypted(value)) return value ?? null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, data, cipher.getAuthTag()]).toString('base64');
}

// Valores antigos, ainda sem criptografia, passam direto (migração gradual)
function decrypt(value, context) {
    if (!isEncrypted(value)) return value;
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString('utf8');
}

// Colunas protegidas por tabela (nomes ficam em texto: os relatórios e os JOINs dependem deles)
const FIELDS = {
    leads: ['email', 'phone', 'message', 'ai_summary', 'ai_next_steps', 'ai_reply'],
    clients: ['email', 'phone', 'notes']
};

const encryptRow = (table, row) => {
    const out = { ...row };
    for (const col of FIELDS[table] || []) if (col in out) out[col] = encrypt(out[col], `${table}.${col}`);
    return out;
};

const decryptRow = (table, row) => {
    if (!row) return row;
    const out = { ...row };
    for (const col of FIELDS[table] || []) if (col in out) out[col] = decrypt(out[col], `${table}.${col}`);
    return out;
};

module.exports = { encrypt, decrypt, encryptRow, decryptRow, isEncrypted, FIELDS, loadKey };
