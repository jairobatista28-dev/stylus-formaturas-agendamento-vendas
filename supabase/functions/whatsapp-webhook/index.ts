import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('Webhook received:', JSON.stringify(body, null, 2));

    // Uazapi format: { type: "message.received", data: { ... } }
    // Also supports Evolution API format for backward compatibility
    const eventType = body.type || body.event;
    const data = body.data || body.body || body;

    // Handle connection updates (Uazapi format)
    if (eventType === 'connection.update' || eventType === 'CONNECTION_UPDATE') {
      const state = data?.state || data?.status;
      console.log('Connection state update:', state);

      if (state === 'open' || state === 'connected') {
        await updateSetting('whatsapp_connected', 'true');
      } else {
        await updateSetting('whatsapp_connected', 'false');
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle incoming messages (Uazapi format: type = "message.received")
    if (eventType === 'message.received' || eventType === 'MESSAGES_UPSERT' || eventType === 'messages.upsert') {
      // Uazapi sends single message in data, Evolution sends array
      const messages = Array.isArray(data) ? data : [data];

      for (const msg of messages) {
        // Skip outgoing messages
        if (msg.key?.fromMe === true || msg.fromMe === true) continue;

        // Extract phone number
        // Uazapi format: key.remoteJid or remoteJid
        // Evolution format: key.remoteJid
        let phone = '';
        const remoteJid = msg.key?.remoteJid || msg.remoteJid || '';
        if (remoteJid) {
          phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
        }

        // Extract message text
        // Uazapi format: message.text or text or message.conversation
        // Evolution format: message.conversation or message.extendedTextMessage.text
        const text = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     msg.message?.text ||
                     msg.text ||
                     msg.body ||
                     '';

        if (!phone || !text) continue;

        console.log(`Incoming message from ${phone}: ${text}`);

        // Find or create contact
        let contactId = await findOrCreateContact(phone);

        if (!contactId) {
          console.error('Failed to find/create contact for', phone);
          continue;
        }

        // Save incoming message
        await saveMessage(contactId, text, 'in');

        // Trigger AI response (async)
        triggerAIResponse(contactId, text);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle message status updates (delivered, read)
    if (eventType === 'message.update' || eventType === 'MESSAGES_UPDATE' || eventType === 'messages.update') {
      const updates = Array.isArray(data) ? data : [data];

      for (const update of updates) {
        const status = update?.status;
        const messageId = update?.key?.id || update?.id;

        if (status === 'read' || status === 'READ') {
          await markMessageAsRead(messageId);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, type: eventType }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function updateSetting(key: string, value: string) {
  const response = await fetch(`${supabaseUrl}/rest/v1/settings?key=eq.${key}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ value, updated_at: new Date().toISOString() })
  });
  return response.ok;
}

async function findOrCreateContact(phone: string): Promise<string | null> {
  // Clean phone number
  const cleanPhone = phone.replace(/\D/g, '').replace(/^55/, '');
  const fullPhone = `55${cleanPhone}`;

  // Try to find existing contact
  const findResponse = await fetch(
    `${supabaseUrl}/rest/v1/contacts?or=(phone.eq.${fullPhone},phone.eq.${cleanPhone})&select=id`,
    {
      headers: {
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`
      }
    }
  );

  const contacts = await findResponse.json();

  if (contacts && contacts.length > 0) {
    return contacts[0].id;
  }

  // Create new contact
  const createResponse = await fetch(`${supabaseUrl}/rest/v1/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({
      name: `Contato ${phone}`,
      phone: fullPhone,
      status: 'lead',
      assigned_to: 'ia'
    })
  });

  const newContact = await createResponse.json();
  return newContact?.[0]?.id || null;
}

async function saveMessage(contactId: string, content: string, direction: 'in' | 'out') {
  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      contact_id: contactId,
      direction,
      content,
      sent_by: direction === 'in' ? 'contato' : 'ia',
      delivered: true,
      read: direction === 'in'
    })
  });
}

async function markMessageAsRead(messageId: string | undefined) {
  if (!messageId) return;

  await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ read: true })
  });
}

async function triggerAIResponse(contactId: string, text: string) {
  // Call the process-message edge function
  try {
    await fetch(`${supabaseUrl}/functions/v1/process-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ contactId, text })
    });
  } catch (error) {
    console.error('Error triggering AI response:', error);
  }
}
