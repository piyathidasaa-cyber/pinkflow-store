export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { imageBase64, mimeType, userEmail } = JSON.parse(event.body);

    if (!imageBase64 || !userEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'กรุณาแนบรูปสลิปให้ครบถ้วน' }),
      };
    }

    // 1. แปลง Base64 เป็นไฟล์รูปภาพเพื่อส่งให้ EasySlip API v1
    const base64Clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    const blob = new Blob([buffer], { type: mimeType || 'image/jpeg' });

    const formData = new FormData();
    formData.append('file', blob, 'slip.jpg');

    const easySlipRes = await fetch('https://developer.easyslip.com/api/v1/verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.EASYSLIP_ACCESS_TOKEN}`,
      },
      body: formData,
    });

    const result = await easySlipRes.json();

    if (!easySlipRes.ok || result.status !== 200 || !result.data) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'ไม่สามารถอ่านข้อมูลสลิปได้ กรุณาใช้สลิปที่มี QR ชัดเจน' }),
      };
    }

    const slip = result.data;
    const transRef = slip.transRef;
    const amount = Number(slip.amount?.amount || 0);
    const slipTime = new Date(slip.date).getTime();

    // 2. เช็กเวลาโอนห้ามเกิน 30 นาที
    if ((Date.now() - slipTime) / (1000 * 60) > 30) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'สลิปหมดอายุ (กรุณาใช้สลิปที่โอนภายใน 30 นาทีล่าสุด)' }),
      };
    }

    // 3. เช็กเลขท้ายบัญชีผู้รับเงินต้องตรงกับบัญชีร้าน
    const bankAcc = (slip.receiver?.account?.bank?.value || '').replace(/\D/g, '');
    const proxyAcc = (slip.receiver?.account?.proxy?.value || '').replace(/\D/g, '');
    const shopLast4 = process.env.SHOP_PROMPTPAY_LAST4;

    if (!bankAcc.endsWith(shopLast4) && !proxyAcc.endsWith(shopLast4)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'บัญชีผู้รับเงินไม่ตรงกับบัญชีของร้านค้า' }),
      };
    }

    // 4. บันทึก transRef ลง Supabase (หากซ้ำจะ Error ทันที)
    const sbHeaders = {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    const insertSlipRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/slip_transactions`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ trans_ref: transRef, amount }),
    });

    if (!insertSlipRes.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'สลิปนี้ถูกใช้งานไปแล้ว ไม่สามารถใช้ซ้ำได้' }),
      };
    }

    // 5. อัปเดตยอดเครดิตให้ลูกค้าใน Supabase
    const userRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`,
      { headers: sbHeaders }
    );
    const users = await userRes.json();
    const currentBalance = users[0] ? Number(users[0].balance) : 0;
    const newBalance = currentBalance + amount;

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ balance: newBalance }),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        transRef,
        amount,
        newBalance,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'เกิดข้อผิดพลาดในการตรวจสอบสลิป' }),
    };
  }
}
