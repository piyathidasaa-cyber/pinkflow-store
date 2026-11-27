export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { qrCode, imageBase64, mimeType, userEmail } = JSON.parse(event.body || '{}');
    if ((!qrCode && !imageBase64) || !userEmail) {
      return {
        statusCode: 400,
…      statusCode: 500,
      body: JSON.stringify({ error: `ระบบตรวจสอบสลิปขัดข้อง: ${err.message}` }),
    };
  }
}
