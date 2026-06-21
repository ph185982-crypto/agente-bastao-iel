const axios = require('axios');

const BASE = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}`;
const HEADERS = {
  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

async function sendText(to, text) {
  await axios.post(`${BASE}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  }, { headers: HEADERS });
}

async function downloadMedia(mediaId) {
  const { data: meta } = await axios.get(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    { headers: HEADERS }
  );
  const { data } = await axios.get(meta.url, {
    headers: HEADERS,
    responseType: 'arraybuffer',
  });
  return { buffer: Buffer.from(data), mimeType: meta.mime_type };
}

async function markRead(messageId) {
  await axios.post(`${BASE}/messages`, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  }, { headers: HEADERS }).catch(() => {});
}

module.exports = { sendText, downloadMedia, markRead };
