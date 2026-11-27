export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { qrCode, imageBase64, mimeType, userEmail } = JSON.parse(event.body || '{}');
    if ((!qrCode && !imageBase64) || !userEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'กรุณาแนบรูปสลิปที่มี QR Code และระบุอีเมลก่อนเติมเงิน' }),
      };
    }

    let transRef = '';
    let amount = 0;
    let slipTime = 0;
    let receiverAccNumbers = '';

    // โหมดที่ 1: ใช้ Slip2Go API (รองรับทั้งส่งรหัส qrCode ตรงและรูป Base64)
    if (process.env.SLIP2GO_API_SECRET) {
      let baseOrigin = 'https://connect.slip2go.com';
      if (process.env.SLIP2GO_VERIFY_URL) {
        try {
          baseOrigin = new URL(process.env.SLIP2GO_VERIFY_URL).origin;
        } catch (e) {}
      }

      let slip = null;
      let lastApiMessage = '';

      // 1A. ถ้าหน้าเว็บสแกนรหัส QR จากสลิปได้แล้ว ให้ส่งตรวจด้วย qr-code/info ทันที (แม่นยำและเร็วที่สุด)
      if (qrCode) {
        const qrRes = await fetch(`${baseOrigin}/api/verify-slip/qr-code/info`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SLIP2GO_API_SECRET}`,
          },
          body: JSON.stringify({ payload: { qrCode } }),
        });
        const qrData = await qrRes.json();
        if (qrRes.ok && qrData?.data) {
          slip = qrData.data;
        } else {
          lastApiMessage = qrData?.message || qrData?.error || '';
        }
      }

      // 1B. สำรอง: หากยังไม่ได้ข้อมูล ให้ส่งรูป Base64 ไปตรวจที่ qr-base64/info
      if (!slip && imageBase64) {
        const b64Res = await fetch(`${baseOrigin}/api/verify-slip/qr-base64/info`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SLIP2GO_API_SECRET}`,
          },
          body: JSON.stringify({ payload: { imageBase64 } }),
        });
        const b64Data = await b64Res.json();
        if (b64Res.ok && b64Data?.data) {
          slip = b64Data.data;
        } else {
          lastApiMessage = b64Data?.message || b64Data?.error || lastApiMessage;
        }
      }

      if (!slip) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `ไม่พบ QR Code ในสลิปหรือสลิปไม่ถูกต้อง (${lastApiMessage || 'กรุณาใช้รูปสลิปต้นฉบับจากแอปธนาคาร'})`,
          }),
        };
      }

      transRef = slip.transRef || slip.referenceId || '';
      amount = Number(slip.amount || 0);
      slipTime = new Date(slip.dateTime || slip.date).getTime();
      receiverAccNumbers = JSON.stringify(slip.receiver || '').replace(/\D/g, '');
    }
    // โหมดที่ 2: ใช้ EasySlip API v1
    else if (process.env.EASYSLIP_ACCESS_TOKEN) {
      const base64Clean = (imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const blob = new Blob([buffer], { type: mimeType || 'image/jpeg' });
      const formData = new FormData();
      formData.append('file', blob, 'slip.jpg');

      const easyRes = await fetch('https://developer.easyslip.com/api/v1/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.EASYSLIP_ACCESS_TOKEN}` },
        body: formData,
      });
      const easyData = await easyRes.json();

      if (!easyRes.ok || easyData.status !== 200 || !easyData.data) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'EasySlip: ไม่พบข้อมูล QR Code ในสลิป' }),
        };
      }

      const slip = easyData.data;
      transRef = slip.transRef;
      amount = Number(slip.amount?.amount || 0);
      slipTime = new Date(slip.date).getTime();
      receiverAccNumbers = JSON.stringify(slip.receiver || '').replace(/\D/g, '');
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'ยังไม่ได้ตั้งค่า API Key ตรวจสลิปบน Netlify' }),
      };
    }

    if (!transRef || amount <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'ข้อมูลสลิปไม่ครบถ้วนหรือยอดโอนไม่ถูกต้อง' }),
      };
    }

    // เช็กเวลาโอนไม่เกิน 30 นาที
    if (slipTime && !Number.isNaN(slipTime) && (Date.now() - slipTime) / (1000 * 60) > 30) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'สลิปหมดอายุ (กรุณาใช้สลิปที่โอนภายใน 30 นาทีล่าสุด)' }),
      };
    }

    // เช็กเลขท้าย 4 ตัวบัญชีผู้รับเงิน
    const shopLast4 = (process.env.SHOP_PROMPTPAY_LAST4 || '').replace(/\D/g, '').slice(-4);
    if (shopLast4 && receiverAccNumbers && !receiverAccNumbers.includes(shopLast4)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'บัญชีผู้รับเงินไม่ตรงกับบัญชีของร้านค้า' }),
      };
    }

    const sbUrl = (process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
    const sbHeaders = {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    // บันทึก transRef ป้องกันสลิปซ้ำ
    const slipInsert = await fetch(`${sbUrl}/rest/v1/slip_transactions`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ trans_ref: transRef, amount }),
    });

    if (!slipInsert.ok) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'สลิปนี้ถูกใช้งานไปแล้ว ไม่สามารถใช้ซ้ำได้' }),
      };
    }

    // บวกเครดิตเข้าบัญชีลูกค้าใน Supabase
    const uRes = await fetch(
      `${sbUrl}/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`,
      { headers: sbHeaders }
    );
    const users = await uRes.json();
    const newBalance = (users[0] ? Number(users[0].balance) : 0) + amount;

    await fetch(`${sbUrl}/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ balance: newBalance }),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, transRef, amount, newBalance }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `ระบบตรวจสอบสลิปขัดข้อง: ${err.message}` }),
    };
  }
}
