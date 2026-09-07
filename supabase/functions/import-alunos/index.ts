import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return json({ error: "Arquivo nao enviado" }, 400);
    }

    // Read buffer once
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const data: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

    if (data.length === 0) {
      return json({ error: "Arquivo vazio ou sem dados validos" }, 400);
    }

    const alunos = data.map((r) => ({
      nome: r.nome || r.Nome || r.NOME || "",
      telefone: String(r.telefone || r.Telefone || r.TELEFONE || r.celular || r.Celular || "").replace(/\D/g, ""),
      contrato: r.contrato || r.Contrato || r.CONTRATO || r.numero_contrato || null,
      curso: r.curso || r.Curso || r.CURSO || null,
      data: r.data || r.Data || r.DATA || null,
      turno: r.turno || r.Turno || r.TURNO || null,
      local: r.local || r.Local || r.LOCAL || null,
      status: r.status || r.Status || r.STATUS || "pending",
    })).filter(a => a.nome && a.telefone);

    if (alunos.length === 0) {
      return json({ error: "Nenhum aluno valido encontrado. Verifique se ha colunas 'nome' e 'telefone'" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error } = await sb.from("alunos").upsert(alunos, { onConflict: "contrato" });

    if (error) {
      console.error("Supabase error:", error);
      throw new Error(error.message);
    }

    return json({ success: true, importados: alunos.length });
  } catch (e) {
    console.error("Import error:", e);
    return json({ error: e.message || "Erro ao processar arquivo" }, 500);
  }
});
