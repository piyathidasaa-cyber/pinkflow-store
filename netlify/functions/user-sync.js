export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'กรุณาระบุอีเมล' }) };
    }

    const sbHeaders = {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    const findRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
      { headers: sbHeaders }
    );
    let users = await findRes.json();

    if (!users || users.length === 0) {
      const createRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({ email, balance: 0, points: 0, tier: 'MEMBER' }),
      });
      users = await createRes.json();
    }

    const ordersRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/orders?user_email=eq.${encodeURIComponent(email)}&order=created_at.desc`,
      { headers: sbHeaders }
    );
    const orders = await ordersRes.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        user: users[0],
        orders: Array.isArray(orders) ? orders : [],
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ' }) };
  }
}
