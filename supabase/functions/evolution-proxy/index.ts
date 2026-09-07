import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function getSettings(): Promise<Record<string, string>> {
  const response = await fetch(`${supabaseUrl}/rest/v1/settings?select=key,value`, {
    headers: {
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    }
  });
  const data = await response.json();
  const map: Record<string, string> = {};
  (data || []).forEach((s: { key: string; value: string }) => {
    // Trim values to remove accidental spaces
    map[s.key] = s.value?.trim() || '';
  });
  return map;
}

async function updateSetting(key: string, value: string) {
  // Try update first
  const updateRes = await fetch(`${supabaseUrl}/rest/v1/settings?key=eq.${key}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ value, updated_at: new Date().toISOString() })
  });

  // If no row updated (404 or 0 rows), try insert
  if (updateRes.status === 404 || updateRes.status === 400) {
    await fetch(`${supabaseUrl}/rest/v1/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ key, value })
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const settings = await getSettings();
    const apiUrl = settings.uazapi_api_url || settings.evolution_api_url || '';
    const apiToken = settings.uazapi_api_token || settings.evolution_api_key || '';
    const instanceName = settings.uazapi_instance_name || settings.evolution_instance_name || 'stylus_formaturas';

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (!apiToken) {
      return new Response(JSON.stringify({ success: false, error: 'Token nao configurado. Configure o Token da Uazapi nas configuracoes.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!apiUrl) {
      return new Response(JSON.stringify({ success: false, error: 'URL da API nao configurada. Configure a URL da Uazapi nas configuracoes.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Clean URL - remove trailing slash
    const baseUrl = apiUrl.replace(/\/$/, '');

    // Common headers for Uazapi - Authorization: Bearer {token}
    const authHeaders = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    };

    let result: Record<string, unknown> = {};

    switch (action) {
      case 'check_status': {
        try {
          // Uazapi correct endpoint: GET /instance/connectStatus/${instanceName}
          // Header: Authorization: Bearer {token}
          let res = await fetch(`${baseUrl}/instance/connectStatus/${encodeURIComponent(instanceName)}`, {
            method: 'GET',
            headers: authHeaders
          });

          // If 404, try fallback endpoint
          if (res.status === 404) {
            console.log('[evolution-proxy] connectStatus 404, trying fetchInstances...');
            const fallbackRes = await fetch(`${baseUrl}/instance/fetchInstances`, {
              method: 'GET',
              headers: authHeaders
            });

            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              const instances = Array.isArray(fallbackData) ? fallbackData : fallbackData?.instances || [];
              const found = instances.find((inst: any) => inst?.name === instanceName || inst?.instanceName === instanceName);

              if (found) {
                const connected = found?.status === 'connected' || found?.state === 'open' || found?.connected === true;
                await updateSetting('whatsapp_connected', connected ? 'true' : 'false');
                result = { success: true, state: found?.status || found?.state, connected };
              } else {
                result = { success: false, error: 'Instancia nao encontrada' };
              }
            } else {
              result = { success: false, error: 'API indisponivel' };
            }
            break;
          }

          if (!res.ok) {
            const errText = await res.text();
            result = {
              success: false,
              error: `Erro ${res.status}: ${errText || 'Instancia nao encontrada. Verifique o nome da instancia.'}`
            };
            break;
          }

          const data = await res.json();
          const { connected, state } = parseUazapiStatus(data);

          await updateSetting('whatsapp_connected', connected ? 'true' : 'false');

          result = { success: true, state, connected };
        } catch (fetchErr) {
          result = { success: false, error: fetchErr instanceof Error ? fetchErr.message : 'Erro ao conectar com a API' };
        }
        break;
      }

      case 'create_instance': {
        result = { success: true, message: 'Instancia criada via painel Uazapi' };
        break;
      }

      case 'connect': {
        // Uazapi connect endpoint: GET /instance/connect/{instanceName}
        try {
          const res = await fetch(`${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
            method: 'GET',
            headers: authHeaders
          });

          if (!res.ok) {
            const err = await res.text();
            result = { success: false, error: `Erro ${res.status}: ${err || 'Nao foi possivel conectar'}` };
            break;
          }

          const data = await res.json();
          // QR code may come in different formats
          const qrcode = data?.qrcode || data?.base64 || data?.code || data?.data?.qrcode || data?.qr;
          result = qrcode ? { success: true, qrcode } : { success: true, message: 'Conexao iniciada' };
        } catch (fetchErr) {
          result = { success: false, error: fetchErr instanceof Error ? fetchErr.message : 'Erro ao conectar' };
        }
        break;
      }

      case 'get_qrcode': {
        // Uazapi QR endpoint: GET /instance/connect/{instanceName}
        try {
          const res = await fetch(`${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, {
            method: 'GET',
            headers: authHeaders
          });

          if (!res.ok) {
            const err = await res.text();
            result = { success: false, error: `Erro ${res.status}: ${err || 'Nao foi possivel obter QR Code'}` };
            break;
          }

          const data = await res.json();
          const qrcode = data?.qrcode || data?.base64 || data?.code || data?.data?.qrcode || data?.qr;
          result = qrcode ? { success: true, qrcode } : { success: false, error: 'QR Code nao encontrado' };
        } catch (fetchErr) {
          result = { success: false, error: fetchErr instanceof Error ? fetchErr.message : 'Erro ao buscar QR Code' };
        }
        break;
      }

      case 'send_text': {
        const { number, text } = body;
        if (!number || !text) {
          result = { success: false, error: 'Numero e texto sao obrigatorios' };
          break;
        }

        try {
          // Format number
          let cleanNumber = number.replace(/\D/g, '');
          if (!cleanNumber.startsWith('55')) {
            cleanNumber = `55${cleanNumber}`;
          }

          // Uazapi send endpoint: POST /message/sendText/${instanceName}
          const res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              number: cleanNumber,
              text: text
            })
          });

          if (!res.ok) {
            const err = await res.text();
            result = { success: false, error: `Erro ${res.status}: ${err}` };
          } else {
            const data = await res.json().catch(() => ({}));
            result = { success: true, messageId: data?.id || data?.key?.id };
          }
        } catch (fetchErr) {
          result = { success: false, error: fetchErr instanceof Error ? fetchErr.message : 'Erro ao enviar mensagem' };
        }
        break;
      }

      case 'list_instances': {
        result = { success: true, instances: [{ name: instanceName }] };
        break;
      }

      default:
        result = { success: false, error: `Acao desconhecida: ${action}` };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Uazapi proxy error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Erro interno'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper to parse Uazapi status response
function parseUazapiStatus(data: unknown): { connected: boolean; state: string } {
  let connected = false;
  let state = 'unknown';

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;

    // Uazapi format: { connected: boolean, jid: string, loggedIn: boolean, resetting: boolean }
    if ('connected' in obj && typeof obj.connected === 'boolean') {
      connected = obj.connected;
      state = connected ? 'connected' : 'disconnected';
    } else if ('loggedIn' in obj && typeof obj.loggedIn === 'boolean') {
      connected = obj.loggedIn;
      state = connected ? 'connected' : 'disconnected';
    } else if ('status' in obj) {
      state = String(obj.status);
      connected = state === 'connected' || state === 'open' || state === 'ONLINE';
    } else if ('state' in obj) {
      state = String(obj.state);
      connected = state === 'connected' || state === 'open' || state === 'ONLINE';
    }

    // Also check instance.state for Uazapi
    if ('instance' in obj && typeof obj.instance === 'object' && obj.instance !== null) {
      const inst = obj.instance as Record<string, unknown>;
      if ('state' in inst) {
        const instState = String(inst.state);
        if (instState === 'open' || instState === 'connected') {
          connected = true;
          state = instState;
        }
      }
    }
  }

  return { connected, state };
}
