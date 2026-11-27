exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'กรุณาระบุอีเมล' }) };
    }

    const sbUrl = (process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();

    if (!sbUrl || !sbKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_SERVICE_KEY ใน Netlify' }),
      };
    }

    const sbHeaders = {
      apikey: sbKey,
      ...(sbKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${sbKey}` }),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    const findRes = await fetch(
      `${sbUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
      { headers: sbHeaders }
    );
    let users = await findRes.json();

    if (!findRes.ok || !Array.isArray(users)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Supabase แจ้งเตือน: ${users?.message || JSON.stringify(users)}`,
        }),
      };
    }

    if (users.length === 0) {
      const createRes = await fetch(`${sbUrl}/rest/v1/users`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({ email, balance: 0, points: 0, tier: 'MEMBER' }),
      });
      const created = await createRes.json();

      if (!createRes.ok || !Array.isArray(created) || created.length === 0) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `บันทึกผู้ใช้ไม่สำเร็จ: ${created?.message || JSON.stringify(created)}`,
          }),
        };
      }
      users = created;
    }

    const ordersRes = await fetch(
      `${sbUrl}/rest/v1/orders?user_email=eq.${encodeURIComponent(email)}&order=created_at.desc`,
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `เชื่อมต่อฐานข้อมูลไม่สำเร็จ: ${err.message}` }),
    };
  }
}
