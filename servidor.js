// =====================================================================
//  CobraDiario Online — Servidor (sin dependencias, solo Node.js)
//  Usuarios + roles + rutas + reportes + base de datos JSON
//  Ejecuta:  node servidor.js   →  http://127.0.0.1:8090
// =====================================================================
"use strict";

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');

/* ---------- fechas ---------- */
const pad = n => String(n).padStart(2, '0');
const fmtISO = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hoyISO = () => fmtISO(new Date());
function parseISO(s){ if(!s) return null; const p = String(s).split('-').map(Number); if(p.length < 3 || p.some(isNaN)) return null; return new Date(p[0], p[1] - 1, p[2]); }
function addDias(iso, n){ const d = parseISO(iso); if(!d) return null; d.setDate(d.getDate() + n); return fmtISO(d); }
function diffDias(a, b){ const da = parseISO(a), db = parseISO(b); if(!da || !db) return 0; return Math.round((db - da) / 86400000); }

/* ---------- credenciales ---------- */
const makeSalt = () => crypto.randomBytes(8).toString('hex');
const hash = (pass, salt) => crypto.scryptSync(String(pass), salt, 32).toString('hex');
const token = () => crypto.randomBytes(24).toString('hex');

/* ---------- datos (base JSON) ---------- */
function seedClientes(){
  const t = hoyISO();
  const A = n => addDias(t, n);
  const mk = (nombre, telefono, zona, direccion, cuota, inicio, ultimo, deuda, dias, asignadoA) => {
    const c = { id: 'c' + Math.random().toString(36).slice(2, 9), nombre, telefono, zona, direccion, cuota, fechaInicio: inicio, ultimoPago: ultimo, deudaTotal: deuda, diasPagados: dias, notas: '', historial: [], asignadoA: asignadoA || null, creadoPor: null };
    if(dias) for(let i = 0; i < Math.min(dias, 5); i++) c.historial.push({ fecha: addDias(inicio, i), monto: cuota });
    return c;
  };
  return [
    mk('Carlos Andrés Mendoza','300 123 4567','Centro','Cra 50 #45-12',15000, A(-45), t, 675000, 45, 'u-carlos'),
    mk('María Fernanda Rojas','310 234 5678','El Poblado','Cll 10 #43E-45',20000, A(-30), A(-1), 600000, 29, 'u-carlos'),
    mk('Jhonatan Pérez Quintero','312 345 6789','Buenos Aires','Cra 48 #56-20',12000, A(-20), A(-2), 240000, 18, null),
    mk('Luisa Fernanda Gómez','315 456 7890','Laureles','Cll 32 #76-30',18000, A(-10), A(-4), 180000, 6, null),
    mk('Pedro Nel Quintero','316 567 8901','Manrique','Cra 45 #69-10',10000, A(-60), A(-7), 600000, 53, null),
    mk('Andrea Carolina Torres','318 678 9012','Robledo','Cll 65 #72-40',25000, A(-5), A(-1), 125000, 4, null),
    mk('Luis Fernando Zapata','301 789 0123','Belén','Cra 76 #30A-25',14000, A(-1), A(-1), 14000, 0, null),
    mk('Sofía Herrera Mejía','302 890 1234','Castilla','Cll 90 #69-15',16000, A(-8), t, 128000, 8, null),
    mk('Miguel Ángel Castaño','304 901 2345','Aranjuez','Cra 47 #88-22',11000, A(-40), A(-10), 440000, 30, null),
    mk('Valentina Osorio','305 012 3456','La América','Cll 39 #71-18',17000, A(-25), t, 425000, 25, null),
    mk('Diego Alejandro Salazar','306 123 4567','Guayabal','Cll 10 #52-190',13000, A(-15), A(-1), 195000, 14, null),
    mk('Camila Restrepo Uribe','307 234 5678','Estadio','Cra 70 #48-05',22000, t, t, 22000, 0, null)
  ];
}

function defaultDb(){
  const saltAdmin = makeSalt();
  return {
    config: {
      negocio: 'CobraDiario', moneda: '$', umbralZonaRoja: 3, diasNuevo: 7, diasDescanso: [0],
      paisCodigo: '57', navApp: 'google',
      mensajeRecordatorio: 'Hola {nombre} 👋, te escribe {negocio}. Recuerda tu cuota de {cuota} ({estado}). ¡Gracias! 🙏'
    },
    users: [
      { id: 'u-admin', usuario: 'Erick', nombre: 'Erick', rol: 'admin', telefono: '', salt: saltAdmin, passHash: hash('12345', saltAdmin), activo: true }
    ],
    clientes: []
  };
}

let db = null;
function loadDb(){
  try{
    if(fs.existsSync(DATA_FILE)){
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      db = JSON.parse(raw);
    } else { db = defaultDb(); saveDb(); }
  }catch(e){ db = defaultDb(); }
}
let saving = false;
function saveDb(){
  if(saving) return; saving = true;
  try{
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }catch(e){ console.error('Error guardando:', e.message); }
  saving = false;
}

/* ---------- sesiones ---------- */
const sessions = {}; // token -> { userId, exp }
function createSession(userId){
  const t = token();
  sessions[t] = { userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 };
  return t;
}
function getUserByToken(req){
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if(!t || !sessions[t]) return null;
  if(sessions[t].exp < Date.now()){ delete sessions[t]; return null; }
  return db.users.find(u => u.id === sessions[t].userId) || null;
}

/* ---------- helpers de negocio ---------- */
function diasAtraso(c){
  if(!c.ultimoPago) return 0;
  const d = diffDias(c.ultimoPago, hoyISO());
  return d > 0 ? d : 0;
}
function estadoDe(c){
  const a = diasAtraso(c);
  if(a <= 0) return 'aldia';
  if(a <= (db.config.umbralZonaRoja || 3)) return 'atrasado';
  return 'zonaroja';
}
function debeHoy(c){ return !!c.ultimoPago && c.ultimoPago < hoyISO(); }
function visibleClientes(user){
  if(user.rol === 'admin') return db.clientes;
  return db.clientes.filter(c => c.asignadoA === user.id);
}
function safeUser(u){ return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, telefono: u.telefono || '', activo: !!u.activo }; }
function safeCliente(c){ return Object.assign({}, c, { historial: (c.historial || []) }); }

/* ---------- utilidades HTTP ---------- */
function send(res, code, data){
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req){
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; if(d.length > 5e6) req.destroy(); });
    req.on('end', () => { try{ resolve(d ? JSON.parse(d) : {}); }catch(e){ resolve({}); } });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon'
};
function serveStatic(req, res){
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if(p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if(!file.startsWith(PUBLIC_DIR)){ res.writeHead(403); res.end('Prohibido'); return; }
  fs.readFile(file, (err, data) => {
    if(err){ res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------- reportes ---------- */
function buildReportes(){
  const hoy = hoyISO();
  const recaudadoDe = (clients) => clients.reduce((s, c) => s + (c.historial || []).filter(h => h.fecha === hoy).reduce((a, h) => a + (Number(h.monto) || 0), 0), 0);
  const porUsuario = db.users.map(u => {
    const cls = db.clientes.filter(c => c.asignadoA === u.id);
    const pagan = cls.filter(debeHoy);
    const rojos = cls.filter(c => estadoDe(c) === 'zonaroja');
    const atr = cls.filter(c => estadoDe(c) === 'atrasado');
    return {
      id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo, telefono: u.telefono || '',
      clientes: cls.length,
      paganHoy: pagan.length,
      totalCobrarHoy: pagan.reduce((s, c) => s + (Number(c.cuota) || 0), 0),
      recaudadoHoy: recaudadoDe(cls),
      atrasados: atr.length,
      zonaRoja: rojos.length
    };
  });
  const all = db.clientes;
  return {
    hoy,
    totales: {
      clientes: all.length,
      alDia: all.filter(c => estadoDe(c) === 'aldia').length,
      atrasados: all.filter(c => estadoDe(c) === 'atrasado').length,
      zonaRoja: all.filter(c => estadoDe(c) === 'zonaroja').length,
      paganHoy: all.filter(debeHoy).length,
      totalCobrarHoy: all.filter(debeHoy).reduce((s, c) => s + (Number(c.cuota) || 0), 0),
      recaudadoHoy: recaudadoDe(all)
    },
    porUsuario
  };
}

/* ---------- API ---------- */
async function handleApi(req, res, user, pathname){
  const method = req.method;
  const parts = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [r0, r1] = parts;

  // ---- login (sin token) ----
  if(method === 'POST' && r0 === 'login'){
    const b = await readBody(req);
    const u = db.users.find(x => x.usuario.toLowerCase() === String(b.usuario || '').toLowerCase());
    if(!u || !u.activo || hash(b.pass || '', u.salt) !== u.passHash) return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
    return send(res, 200, { token: createSession(u.id), user: safeUser(u) });
  }

  // ---- sesión ----
  if(method === 'GET' && r0 === 'me') return send(res, 200, { user: safeUser(user) });

  // ---- cambiar mi contraseña ----
  if(method === 'POST' && r0 === 'me' && r1 === 'password'){
    const b = await readBody(req);
    if(!b.actual || !b.nueva) return send(res, 400, { error: 'Faltan datos' });
    if(String(b.nueva).length < 4) return send(res, 400, { error: 'Mínimo 4 caracteres' });
    if(hash(b.actual, user.salt) !== user.passHash) return send(res, 401, { error: 'Contraseña actual incorrecta' });
    user.salt = makeSalt();
    user.passHash = hash(b.nueva, user.salt);
    saveDb();
    return send(res, 200, { ok: true });
  }

  // ---- reset (admin): borrar todos los clientes ----
  if(method === 'POST' && r0 === 'reset'){
    if(user.rol !== 'admin') return send(res, 403, { error: 'Solo el administrador' });
    db.clientes = [];
    saveDb();
    return send(res, 200, { ok: true });
  }

  // ---- config ----
  if(r0 === 'config'){
    if(method === 'GET') return send(res, 200, { config: db.config });
    if(method === 'PUT'){
      if(user.rol !== 'admin') return send(res, 403, { error: 'Sin permiso' });
      const b = await readBody(req);
      db.config = Object.assign({}, db.config, b.config || {});
      saveDb();
      return send(res, 200, { config: db.config });
    }
  }

  // ---- reportes (admin) ----
  if(method === 'GET' && r0 === 'reportes'){
    if(user.rol !== 'admin') return send(res, 403, { error: 'Sin permiso' });
    return send(res, 200, { reportes: buildReportes() });
  }

  // ---- usuarios (admin) ----
  if(r0 === 'users'){
    if(user.rol !== 'admin') return send(res, 403, { error: 'Solo el administrador' });
    // POST /api/users/:id/resetpass
    if(method === 'POST' && r1 && parts[2] === 'resetpass'){
      const b = await readBody(req);
      const u = db.users.find(x => x.id === r1);
      if(!u) return send(res, 404, { error: 'No existe' });
      if(!b.newPass) return send(res, 400, { error: 'Falta contraseña' });
      u.salt = makeSalt();
      u.passHash = hash(b.newPass, u.salt);
      saveDb();
      return send(res, 200, { ok: true });
    }
    if(method === 'GET' && !r1) return send(res, 200, { users: db.users.map(safeUser) });
    if(method === 'POST' && !r1){
      const b = await readBody(req);
      if(!b.usuario || !b.pass){ return send(res, 400, { error: 'Faltan datos' }); }
      if(db.users.some(u => u.usuario.toLowerCase() === String(b.usuario).toLowerCase())) return send(res, 400, { error: 'Ese usuario ya existe' });
      const salt = makeSalt();
      const u = { id: 'u' + Math.random().toString(36).slice(2, 9), usuario: String(b.usuario).trim(), nombre: String(b.nombre || b.usuario).trim(), rol: b.rol === 'admin' ? 'admin' : 'cobrador', telefono: String(b.telefono || ''), salt, passHash: hash(b.pass, salt), activo: true };
      db.users.push(u); saveDb();
      return send(res, 200, { user: safeUser(u) });
    }
    if(method === 'PUT' && r1){
      const b = await readBody(req);
      const u = db.users.find(x => x.id === r1);
      if(!u) return send(res, 404, { error: 'No existe' });
      if(b.nombre !== undefined) u.nombre = String(b.nombre).trim();
      if(b.telefono !== undefined) u.telefono = String(b.telefono);
      if(b.rol !== undefined) u.rol = b.rol === 'admin' ? 'admin' : 'cobrador';
      if(b.activo !== undefined) u.activo = !!b.activo;
      saveDb();
      return send(res, 200, { user: safeUser(u) });
    }
    if(method === 'DELETE' && r1){
      if(r1 === 'u-admin') return send(res, 400, { error: 'No se puede eliminar al administrador principal' });
      db.users = db.users.filter(x => x.id !== r1);
      db.clientes.forEach(c => { if(c.asignadoA === r1) c.asignadoA = null; });
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  // ---- clientes ----
  if(r0 === 'clientes'){
    if(method === 'GET'){
      const cls = visibleClientes(user).map(safeCliente);
      const usersMap = {};
      db.users.forEach(u => usersMap[u.id] = u.nombre);
      cls.forEach(c => { c.asignadoNombre = c.asignadoA ? (usersMap[c.asignadoA] || '') : ''; });
      return send(res, 200, { clientes: cls, config: db.config, users: user.rol === 'admin' ? db.users.map(safeUser) : [] });
    }
    if(method === 'POST' && !r1){
      const b = await readBody(req);
      const c = Object.assign({ id: 'c' + Math.random().toString(36).slice(2, 9), historial: [], asignadoA: null, creadoPor: user.id }, b, { asignadoA: user.rol === 'admin' ? (b.asignadoA || null) : user.id });
      db.clientes.push(c); saveDb();
      return send(res, 200, { cliente: safeCliente(c) });
    }
    if(method === 'POST' && r1 === 'bulk'){
      const b = await readBody(req);
      const arr = Array.isArray(b.clientes) ? b.clientes : [];
      const added = arr.map(x => {
        const c = Object.assign({ id: 'c' + Math.random().toString(36).slice(2, 9), historial: [], asignadoA: null, creadoPor: user.id }, x, { asignadoA: user.rol === 'admin' ? (x.asignadoA || null) : user.id });
        db.clientes.push(c); return c;
      });
      saveDb();
      return send(res, 200, { ok: true, count: added.length });
    }
    if(r1 && method === 'PUT'){
      const c = db.clientes.find(x => x.id === r1);
      if(!c) return send(res, 404, { error: 'No existe' });
      if(user.rol !== 'admin' && c.asignadoA !== user.id) return send(res, 403, { error: 'Sin permiso' });
      const b = await readBody(req);
      ['nombre','telefono','zona','direccion','notas'].forEach(k => { if(b[k] !== undefined) c[k] = b[k]; });
      ['cuota','deudaTotal','diasPagados'].forEach(k => { if(b[k] !== undefined) c[k] = (b[k] === null || b[k] === '') ? null : Number(b[k]); });
      if(b.fechaInicio !== undefined) c.fechaInicio = b.fechaInicio || null;
      if(b.ultimoPago !== undefined) c.ultimoPago = b.ultimoPago || null;
      if(user.rol === 'admin' && b.asignadoA !== undefined) c.asignadoA = b.asignadoA || null;
      saveDb();
      return send(res, 200, { cliente: safeCliente(c) });
    }
    if(r1 && method === 'DELETE'){
      const c = db.clientes.find(x => x.id === r1);
      if(!c) return send(res, 404, { error: 'No existe' });
      if(user.rol !== 'admin' && c.asignadoA !== user.id) return send(res, 403, { error: 'Sin permiso' });
      db.clientes = db.clientes.filter(x => x.id !== r1); saveDb();
      return send(res, 200, { ok: true });
    }
    if(r1 && method === 'POST' && parts[2] === 'pago'){
      const c = db.clientes.find(x => x.id === r1);
      if(!c) return send(res, 404, { error: 'No existe' });
      if(user.rol !== 'admin' && c.asignadoA !== user.id) return send(res, 403, { error: 'Sin permiso' });
      const b = await readBody(req);
      c.ultimoPago = b.fecha || hoyISO();
      c.historial = c.historial || [];
      c.historial.push({ fecha: b.fecha || hoyISO(), monto: (b.monto !== undefined ? Number(b.monto) : (Number(c.cuota) || 0)) });
      c.diasPagados = (Number(c.diasPagados) || 0) + 1;
      saveDb();
      return send(res, 200, { cliente: safeCliente(c) });
    }
    if(r1 && method === 'POST' && parts[2] === 'asignar'){
      if(user.rol !== 'admin') return send(res, 403, { error: 'Solo el administrador' });
      const c = db.clientes.find(x => x.id === r1);
      if(!c) return send(res, 404, { error: 'No existe' });
      const b = await readBody(req);
      c.asignadoA = b.userId || null;
      saveDb();
      return send(res, 200, { cliente: safeCliente(c) });
    }
    if(r1 && method === 'POST' && parts[2] === 'renovar'){
      const c = db.clientes.find(x => x.id === r1);
      if(!c) return send(res, 404, { error: 'No existe' });
      if(user.rol !== 'admin' && c.asignadoA !== user.id) return send(res, 403, { error: 'Sin permiso' });
      const b = await readBody(req);
      c.fechaInicio = hoyISO();
      c.ultimoPago = hoyISO();
      c.diasPagados = 0;
      if(b.cuota !== undefined) c.cuota = (b.cuota === '' || b.cuota === null) ? null : Number(b.cuota);
      if(b.deudaTotal !== undefined) c.deudaTotal = (b.deudaTotal === '' || b.deudaTotal === null) ? null : Number(b.deudaTotal);
      c.historial = [];
      saveDb();
      return send(res, 200, { cliente: safeCliente(c) });
    }
  }

  send(res, 404, { error: 'Ruta no encontrada' });
}

/* ---------- servidor ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if(pathname.startsWith('/api/')) {
    const user = getUserByToken(req);
    if(!user && !(req.method === 'POST' && pathname === '/api/login')){
      return send(res, 401, { error: 'No autorizado' });
    }
    try{ await handleApi(req, res, user, pathname); }
    catch(e){ console.error(e); send(res, 500, { error: 'Error interno' }); }
    return;
  }
  serveStatic(req, res);
});

if (require.main === module) {
  loadDb();
  server.listen(PORT, () => {
    console.log('CobraDiario Online listo en  http://127.0.0.1:' + PORT);
    console.log('Admin: Erick / 12345   ·   Cobrador demo: Carlos / 12345');
  });
}

module.exports = { loadDb, saveDb, getDb: () => db, handleApi, buildReportes, visibleClientes, diasAtraso, estadoDe, hash, makeSalt, createSession, getUserByToken, safeUser, safeCliente };
