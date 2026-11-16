// Seed idempotente dos clientes do Mapa a partir de db/seed-clientes.json (ou do caminho passado como argumento).
// Formato: array de { name, slug, kind, drive_folder_id, drive_folder_ids?, titular?, grupo?,
//   files:[{title,url,drive_file_id,kind,date}], meetings:[{title,date,recording_url,transcript_url}] }
// Rodar de novo não duplica nada e não sobrescreve início do plano, contato nem resumos já preenchidos.
// SEGURANÇA: só roda em Postgres local. Para outro banco é preciso passar --permitir-remoto (decisão consciente).
//   Uso: DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/seed-clientes.mjs [arquivo.json]
import { readFileSync } from "node:fs";
import { connect, isLocalUrl } from "./connect.mjs";

const args = process.argv.slice(2);
const remote = args.includes("--permitir-remoto");
const file = args.find((a) => !a.startsWith("--")) ?? new URL("./seed-clientes.json", import.meta.url);
const url = process.env.DATABASE_URL ?? process.env.NEON_URL;
if (!url) throw new Error("Defina DATABASE_URL");
if (!isLocalUrl(url) && !remote) throw new Error("Recusado: DATABASE_URL não é um Postgres local. Use --permitir-remoto só se for de propósito.");

const KINDS = ["marketplace", "midia", "ambos"];
const data = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(data)) throw new Error("O JSON do seed precisa ser um array de clientes.");

const db = await connect(url);
const stats = { clientes: 0, arquivos: 0, reunioes: 0 };
try {
  await db.query("begin");
  for (const c of data) {
    if (!c.name || !c.slug || !KINDS.includes(c.kind)) throw new Error(`Cliente inválido no seed: ${JSON.stringify({ name: c.name, slug: c.slug, kind: c.kind })}`);
    const { rows } = await db.query(
      `insert into avanteza.clients (name, slug, kind, drive_folder_id, drive_folder_ids, group_slug, owner_name)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (slug) where slug is not null do update set
         name = excluded.name, kind = excluded.kind,
         drive_folder_id = coalesce(excluded.drive_folder_id, avanteza.clients.drive_folder_id),
         drive_folder_ids = excluded.drive_folder_ids,
         group_slug = coalesce(excluded.group_slug, avanteza.clients.group_slug),
         owner_name = coalesce(excluded.owner_name, avanteza.clients.owner_name)
       returning id`,
      [c.name, c.slug, c.kind, c.drive_folder_id ?? null, c.drive_folder_ids ?? [], c.grupo ?? null, c.titular ?? null],
    );
    const clientId = rows[0].id;
    stats.clientes++;
    for (const f of c.files ?? []) {
      if (!f.title || !/^https?:\/\//.test(f.url ?? "")) throw new Error(`Arquivo inválido em ${c.slug}: ${f.title}`);
      if (f.drive_file_id) {
        await db.query(
          `insert into avanteza.client_files (client_id, title, url, drive_file_id, kind, file_date)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (client_id, drive_file_id) where drive_file_id is not null do update set title = excluded.title, url = excluded.url, kind = excluded.kind, file_date = excluded.file_date`,
          [clientId, f.title, f.url, f.drive_file_id, f.kind ?? "outro", f.date ?? null],
        );
      } else {
        await db.query(
          `insert into avanteza.client_files (client_id, title, url, kind, file_date)
           select $1,$2,$3,$4,$5 where not exists (select 1 from avanteza.client_files where client_id = $1 and url = $3)`,
          [clientId, f.title, f.url, f.kind ?? "outro", f.date ?? null],
        );
      }
      stats.arquivos++;
    }
    for (const m of c.meetings ?? []) {
      if (!m.title || !m.date) throw new Error(`Reunião inválida em ${c.slug}`);
      await db.query(
        `insert into avanteza.meetings (client_id, title, held_at, recording_url, transcript_url)
         values ($1,$2,($3::date + time '12:00') at time zone 'America/Sao_Paulo',$4,$5)
         on conflict (client_id, title, held_at) do update set
           recording_url = coalesce(excluded.recording_url, avanteza.meetings.recording_url),
           transcript_url = coalesce(excluded.transcript_url, avanteza.meetings.transcript_url)`,
        [clientId, m.title, m.date, m.recording_url ?? null, m.transcript_url ?? null],
      );
      stats.reunioes++;
    }
  }
  await db.query("commit");
  console.log(`seed ok: ${stats.clientes} clientes, ${stats.arquivos} arquivos, ${stats.reunioes} reuniões (reaplicável sem duplicar)`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  throw e;
} finally {
  await db.end();
}
