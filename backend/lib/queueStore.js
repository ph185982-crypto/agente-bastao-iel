// Persistência da fila semanal. Usa o cofre Upstash (vault.js) quando as env
// vars existem; sem elas, enabled() === false e o front guarda tudo no
// próprio aparelho (IndexedDB). Arquivos gerados (PNG/MP4) nunca passam por
// aqui: ficam no aparelho que produziu.
const crypto = require('crypto');
const vault = require('./vault');
const { DEFAULT_CONFIG } = require('../../static/esteiraCore');

const ITEMS_KEY = 'queue:items';
const CONFIG_KEY = 'queue:config';

const enabled = () => vault.enabled();

// Só metadados — nunca os arquivos.
function sanitizeItem(raw) {
  const { assets, ...rest } = raw || {};
  void assets;
  return rest;
}

async function getConfig() {
  const saved = enabled() ? await vault.getJSON(CONFIG_KEY) : null;
  return { ...DEFAULT_CONFIG, ...(saved || {}) };
}

async function saveConfig(patch) {
  const next = { ...(await getConfig()), ...(patch || {}) };
  if (enabled()) await vault.setJSON(CONFIG_KEY, next);
  return next;
}

async function allItems() {
  return (enabled() && (await vault.getJSON(ITEMS_KEY))) || [];
}

async function listWeek(weekStartIso) {
  return (await allItems()).filter((i) => i.week_start === weekStartIso);
}

async function createItem(data) {
  const now = new Date().toISOString();
  const item = sanitizeItem({
    id: data.id || crypto.randomUUID(),
    status: 'aguardando',
    created_at: now,
    ...data,
    updated_at: now,
  });
  const items = await allItems();
  items.push(item);
  await vault.setJSON(ITEMS_KEY, items);
  return item;
}

async function updateItem(id, patch) {
  const items = await allItems();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = sanitizeItem({ ...items[idx], ...patch, id, updated_at: new Date().toISOString() });
  await vault.setJSON(ITEMS_KEY, items);
  return items[idx];
}

async function deleteItem(id) {
  const items = await allItems();
  const next = items.filter((i) => i.id !== id);
  await vault.setJSON(ITEMS_KEY, next);
  return next.length !== items.length;
}

module.exports = { enabled, getConfig, saveConfig, listWeek, createItem, updateItem, deleteItem, sanitizeItem };
