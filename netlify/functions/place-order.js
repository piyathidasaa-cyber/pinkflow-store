export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { userEmail, productId, productName, mode, qty, totalPaid, customerNote } = JSON.parse(event.body);

    const sbHeaders = {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    const uRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`, { headers: sbHeaders });
    const users = await uRes.json();
    const user = users[0];

    if (!user || Number(user.balance) < Number(totalPaid)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'ยอดเครดิตคงเหลือไม่เพียงพอ' }) };
    }

    let deliveredCodes = [];

    if (mode === 'INSTANT') {
      const codeRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/product_codes?product_id=eq.${productId}&is_sold=eq.false&limit=${qty}`,
        { headers: sbHeaders }
      );
      const availableCodes = await codeRes.json();

      if (!availableCodes || availableCodes.length < qty) {
        return { statusCode: 400, body: JSON.stringify({ error: 'ขออภัย สินค้าในสต็อกไม่เพียงพอ' }) };
      }

      for (const item of availableCodes) {
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/product_codes?id=eq.${item.id}`, {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify({ is_sold: true, sold_to_email: userEmail, sold_at: new Date().toISOString() }),
        });
        deliveredCodes.push(item.secret_code);
      }
    }

    const newBalance = Number(user.balance) - Number(totalPaid);
    const newPoints = Number(user.points || 0) + Math.floor(Number(totalPaid) / 10);

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(userEmail)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ balance: newBalance, points: newPoints }),
    });

    const orderId = 'ORD-' + Date.now().toString().slice(-6);
    const orderStatus = mode === 'PREORDER' ? 'PENDING_PREORDER' : 'COMPLETED';

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({
        id: orderId,
        user_email: userEmail,
        product_id: productId,
        product_name: productName,
        mode,
        qty,
        total_paid: totalPaid,
        status: orderStatus,
        delivered_code: deliveredCodes.join('\n'),
        customer_note: customerNote || '',
      }),
    });

    if (mode === 'PREORDER' && process.env.RESEND_API_KEY && process.env.ADMIN_EMAIL) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'PinkFlow Store <onboarding@resend.dev>',
          to: [process.env.ADMIN_EMAIL],
          subject: `[PinkFlow Alert] 🔔 มีพรีออเดอร์ใหม่ #${orderId}`,
          html: `<h3>มีคำสั่งซื้อพรีออเดอร์ใหม่</h3><p><b>สินค้า:</b> ${productName}</p><p><b>ลูกค้า:</b> ${userEmail}</p><p><b>หมายเหตุ:</b> ${customerNote || '-'}</p>`,
        }),
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        orderId,
        newBalance,
        newPoints,
        deliveredCodes,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ดำเนินการสั่งซื้อไม่สำเร็จ' }) };
  }
}
