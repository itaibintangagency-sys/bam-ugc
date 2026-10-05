// Pengujian migrasi 20261002000300 (tahap karakter) pada Postgres lokal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, as, rejects, U } from './helpers.mjs';

const URL_OK = 'https://flow.google.com/project/abc';

async function newChar(db, { code = 'C01', voice = 'Aoede', status = 'draft', url = URL_OK, by = U.staffA } = {}) {
  return as(db, by, async () => (await db.query(
    `insert into ugc_characters (code, name, created_by, voice_base, flow_project_url, status) values ($1, $2, $3, $4, $5, $6) returning id`,
    [code, 'Karakter ' + code, by, voice, url, status])).rows[0].id);
}
async function setStatus(db, id, status) { await db.exec('reset role'); await db.query(`update ugc_characters set status = $2 where id = $1`, [id, status]); }
async function addPhoto(db, id, angle = 'face_front', approved = true) {
  return as(db, U.staffA, async () => db.query(`insert into ugc_character_photos (character_id, angle, path, approved, created_by) values ($1, $2, $3, $4, $5)`, [id, angle, `${id}/${angle}.png`, approved, U.staffA]));
}

test('migrasi: berjalan di atas v2, dapat diulang, dan kolom serta tabel baru ada', async () => {
  const db = await makeDb();
  const f = (await import('node:fs')).readFileSync(new URL('../../supabase/migrations/20261002000300_ugc_character_voice.sql', import.meta.url), 'utf8');
  await db.exec(f);
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'ugc_characters'`)).rows.map(r => r.column_name);
  for (const c of ['voice', 'voice_base', 'voice_shared_ok', 'flow_character_name', 'flow_voice_name', 'voice_ref_clip_path', 'intro_video_path', 'ready_at']) assert.ok(cols.includes(c), c);
  for (const t of ['ugc_character_photos', 'ugc_character_tasks']) assert.equal((await db.query(`select to_regclass('public.${t}') as r`)).rows[0].r, t);
});

test('status: staff tidak bisa melompati ke project_ready/voice_in_flow/intro_review/ready, admin bisa', async () => {
  const db = await makeDb();
  const id = await newChar(db);
  await as(db, U.staffA, async () => {
    for (const s of ['project_ready', 'voice_in_flow', 'intro_review', 'ready']) await rejects(db.query(`update ugc_characters set status = $2 where id = $1`, [id, s]), '42501');
    for (const s of ['face_ready', 'dna_locked', 'voice_defined', 'sheet_ready']) await db.query(`update ugc_characters set status = $2 where id = $1`, [id, s]);
    await rejects(db.query(`update ugc_characters set intro_video_path = 'x.mp4' where id = $1`, [id]), '42501');
    await rejects(db.query(`update ugc_characters set voice_shared_ok = true where id = $1`, [id]), '42501');
    await rejects(db.query(`insert into ugc_characters (code, name, created_by, status) values ('CX', 'X', $1, 'ready')`, [U.staffA]), '42501');
  });
  await as(db, U.admin, async () => { await db.query(`update ugc_characters set voice_shared_ok = true where id = $1`, [id]); });
});

test('nama karakter di Flow: tanpa tanda kurung siku atau @, maksimal 40 karakter', async () => {
  const db = await makeDb();
  const id = await newChar(db);
  await as(db, U.staffA, async () => {
    await db.query(`update ugc_characters set flow_character_name = 'Sari Dewi' where id = $1`, [id]);
    for (const bad of ['Sa[ri]', 'Sari@', 'x'.repeat(41), '']) await rejects(db.query(`update ugc_characters set flow_character_name = $2 where id = $1`, [id, bad]), 'ugc_characters_flow_name_check');
  });
});

test('suara: satu suara dasar untuk satu karakter, kecuali disetujui admin', async () => {
  const db = await makeDb();
  await newChar(db, { code: 'C01', voice: 'Aoede' });
  await as(db, U.staffB, async () => {
    await rejects(db.query(`insert into ugc_characters (code, name, created_by, voice_base) values ('C02', 'Dua', $1, 'aoede')`, [U.staffB]), 'ugc_characters_voice_base_uq');
    await db.query(`insert into ugc_characters (code, name, created_by, voice_base) values ('C03', 'Tiga', $1, 'Autonoe')`, [U.staffB]);
  });
  await db.exec(`reset role; update ugc_characters set voice_shared_ok = true where code = 'C01'`);
  await as(db, U.staffB, async () => { await db.query(`insert into ugc_characters (code, name, created_by, voice_base) values ('C04', 'Empat', $1, 'Aoede')`, [U.staffB]); });
  await db.exec(`reset role; update ugc_characters set status = 'archived' where code = 'C03'`);
  await as(db, U.staffB, async () => { await db.query(`insert into ugc_characters (code, name, created_by, voice_base) values ('C05', 'Lima', $1, 'Autonoe')`, [U.staffB]); });
});

test('tugas: prasyarat tiap jenis tugas dan satu tugas aktif per jenis', async () => {
  const db = await makeDb();
  const id = await newChar(db);
  await as(db, U.staffA, async () => {
    await rejects(db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]), 'sheet_ready');
    await db.query(`update ugc_characters set status = 'sheet_ready' where id = $1`, [id]);
    await rejects(db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]), 'belum ada foto yang disetujui');
  });
  await addPhoto(db, id, 'face_front', false);
  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]), 'belum ada foto yang disetujui'); });
  await db.exec(`reset role; update ugc_character_photos set approved = true`);
  await as(db, U.staffA, async () => {
    await db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]);
    await rejects(db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]), 'ugc_character_tasks_active_uq');
    await rejects(db.query(`select ugc_request_char_task($1, 'intro_video', '{"video_json":"{}"}'::jsonb)`, [id]), 'voice_in_flow');
    await rejects(db.query(`select ugc_request_char_task($1, 'tidak_ada')`, [id]), '22023');
  });
  await as(db, U.staffB, async () => { await rejects(db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]), '42501'); });
  const noUrl = await newChar(db, { code: 'C09', voice: 'Despina', url: 'https://contoh.com/x', status: 'sheet_ready' });
  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_request_char_task($1, 'upload_photos')`, [noUrl]), 'project Flow'); });
});

test('siklus lengkap: upload foto → konfirmasi Flow → video perkenalan → review → siap → batch boleh masuk antrean', async () => {
  const db = await makeDb();
  const id = await newChar(db, { status: 'sheet_ready' });
  await addPhoto(db, id, 'face_front'); await addPhoto(db, id, 'full_front');

  // 1. upload foto
  let taskId;
  await as(db, U.staffA, async () => { taskId = (await db.query(`select ugc_request_char_task($1, 'upload_photos') as t`, [id])).rows[0].t; });
  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('laptop-1')`);
    const t = (await db.query(`select ugc_claim_next_char_task('laptop-1') as t`)).rows[0].t;
    assert.equal(t.task_id, taskId); assert.equal(t.kind, 'upload_photos'); assert.equal(t.project_url, URL_OK);
    assert.equal(t.photos.length, 2); assert.equal(t.photos[0].bucket, 'ugc-characters'); assert.equal(t.attempt, 1);
    assert.equal((await db.query(`select ugc_claim_next_char_task('laptop-1') as t`)).rows[0].t, null, 'tidak diambil dua kali');
    assert.equal((await db.query(`select ugc_char_task_progress($1, 'done') as s`, [taskId])).rows[0].s, 'done');
  });
  assert.equal((await db.query(`select status from ugc_characters where id = $1`, [id])).rows[0].status, 'project_ready');
  assert.equal((await db.query(`select count(*)::int as n from ugc_character_photos where flow_uploaded_at is not null`)).rows[0].n, 2);

  // 2. staff mengonfirmasi karakter + suara sudah dibuat di Flow
  await as(db, U.staffB, async () => { await rejects(db.query(`select ugc_confirm_flow_character($1, 'Sari')`, [id]), '42501'); });
  await as(db, U.staffA, async () => {
    await rejects(db.query(`select ugc_confirm_flow_character($1, '  ')`, [id]), 'wajib diisi');
    await db.query(`select ugc_confirm_flow_character($1, 'Sari Dewi', 'Suara Sari')`, [id]);
  });
  assert.equal((await db.query(`select status, flow_character_name, flow_voice_name from ugc_characters where id = $1`, [id])).rows[0].status, 'voice_in_flow');

  // 3. video perkenalan
  await as(db, U.staffA, async () => { taskId = (await db.query(`select ugc_request_char_task($1, 'intro_video', '{"video_json":"{\\"a\\":1}"}'::jsonb) as t`, [id])).rows[0].t; });
  await as(db, U.agent, async () => {
    const t = (await db.query(`select ugc_claim_next_char_task('laptop-1') as t`)).rows[0].t;
    assert.equal(t.kind, 'intro_video'); assert.equal(t.flow_character_name, 'Sari Dewi'); assert.equal(t.payload.video_json, '{"a":1}');
    await db.query(`select ugc_char_task_progress($1, 'done', '{"video_path":"characters/x/intro-1.mp4"}'::jsonb)`, [taskId]);
  });
  const c = (await db.query(`select status, intro_video_path, intro_attempts from ugc_characters where id = $1`, [id])).rows[0];
  assert.deepEqual([c.status, c.intro_video_path, c.intro_attempts], ['intro_review', 'characters/x/intro-1.mp4', 1]);

  // 4. gerbang batch: belum siap
  let batch;
  await as(db, U.staffA, async () => {
    batch = (await db.query(`insert into ugc_batches (character_id, resolution, created_by) values ($1, '360p', $2) returning id`, [id, U.staffA])).rows[0].id;
    const p = (await db.query(`insert into ugc_products (name, created_by) values ('P', $1) returning id`, [U.staffA])).rows[0].id;
    await db.query(`insert into ugc_jobs (batch_id, product_id, seq, status, panel_plan, storyboard_path, video_json, created_by) values ($1, $2, 1, 'approved', '{}'::jsonb, 'a.png', '{"x":1}', $3)`, [batch, p, U.staffA]);
    await rejects(db.query(`select ugc_enqueue_batch($1)`, [batch]), 'belum berstatus siap');
  });

  // 5. review perkenalan
  await as(db, U.staffB, async () => { await rejects(db.query(`select ugc_review_intro($1, true)`, [id]), '42501'); });
  await as(db, U.staffA, async () => {
    assert.equal((await db.query(`select ugc_review_intro($1, true, 'suara cocok', 'characters/x/ref.mp4') as s`, [id])).rows[0].s, 'ready');
    await rejects(db.query(`select ugc_review_intro($1, true)`, [id]), 'intro_review');
    assert.equal((await db.query(`select ugc_enqueue_batch($1) as n`, [batch])).rows[0].n, 1);
  });
  const r = (await db.query(`select status, voice_ref_clip_path, ready_at is not null as ok from ugc_characters where id = $1`, [id])).rows[0];
  assert.deepEqual([r.status, r.voice_ref_clip_path, r.ok], ['ready', 'characters/x/ref.mp4', true]);
  const rev = (await db.query(`select result -> 'review' ->> 'note' as n from ugc_character_tasks where kind = 'intro_video'`)).rows[0].n;
  assert.equal(rev, 'suara cocok');

  // job video kini membawa nama karakter dan voice di Flow
  await as(db, U.agent, async () => {
    const j = (await db.query(`select ugc_claim_next_job('laptop-1') as j`)).rows[0].j;
    assert.equal(j.flow_character_name, 'Sari Dewi'); assert.equal(j.flow_voice_name, 'Suara Sari');
  });
});

test('review: ditolak mengulang, setelah 3 percobaan kembali ke definisi suara', async () => {
  const db = await makeDb();
  const id = await newChar(db, { status: 'sheet_ready' });
  await db.exec(`update ugc_characters set status = 'voice_in_flow', flow_character_name = 'Sari' where id = '${id}'`);
  for (let i = 1; i <= 3; i++) {
    let taskId;
    await as(db, U.staffA, async () => { taskId = (await db.query(`select ugc_request_char_task($1, 'intro_video', '{"video_json":"{}"}'::jsonb) as t`, [id])).rows[0].t; });
    await as(db, U.agent, async () => {
      await db.query(`select ugc_agent_heartbeat('l')`); await db.query(`select ugc_claim_next_char_task('l')`);
      await db.query(`select ugc_char_task_progress($1, 'done', '{"video_path":"v.mp4"}'::jsonb)`, [taskId]);
    });
    await as(db, U.staffA, async () => {
      const to = (await db.query(`select ugc_review_intro($1, false, 'suara berbeda') as s`, [id])).rows[0].s;
      assert.equal(to, i < 3 ? 'voice_in_flow' : 'voice_defined', 'percobaan ' + i);
    });
  }
});

test('tugas: gagal diulang otomatis dengan jeda, lalu gagal permanen; needs_human menjeda antrean', async () => {
  const db = await makeDb();
  const id = await newChar(db, { status: 'sheet_ready' }); await addPhoto(db, id);
  await as(db, U.staffA, async () => { await db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]); });
  await as(db, U.agent, async () => {
    await db.query(`select ugc_agent_heartbeat('l')`);
    const t1 = (await db.query(`select ugc_claim_next_char_task('l') as t`)).rows[0].t;
    assert.equal((await db.query(`select ugc_char_task_progress($1, 'failed', '{"error_kind":"timeout","last_error":"lambat"}'::jsonb) as s`, [t1.task_id])).rows[0].s, 'queued');
    assert.equal((await db.query(`select ugc_claim_next_char_task('l') as t`)).rows[0].t, null, 'jeda sebelum percobaan berikut');
  });
  await db.exec(`reset role; update ugc_character_tasks set not_before = null`);
  await as(db, U.agent, async () => {
    const t2 = (await db.query(`select ugc_claim_next_char_task('l') as t`)).rows[0].t; assert.equal(t2.attempt, 2);
    await db.query(`select ugc_char_task_progress($1, 'needs_human', '{"last_error":"captcha"}'::jsonb)`, [t2.task_id]);
    assert.equal((await db.query(`select ugc_agent_heartbeat('l') as h`)).rows[0].h.paused, true);
  });
  assert.equal((await db.query(`select status from ugc_characters where id = $1`, [id])).rows[0].status, 'sheet_ready', 'status karakter tidak maju');
});

test('admin: tandai siap wajib alasan, staff tidak boleh', async () => {
  const db = await makeDb();
  const id = await newChar(db);
  await as(db, U.staffA, async () => { await rejects(db.query(`select ugc_admin_mark_ready($1, 'alasan yang cukup panjang')`, [id]), '42501'); });
  await as(db, U.admin, async () => {
    await rejects(db.query(`select ugc_admin_mark_ready($1, 'pendek')`, [id]), 'minimal 10 karakter');
    await db.query(`select ugc_admin_mark_ready($1, 'karakter lama yang sudah terbukti stabil')`, [id]);
  });
  const r = (await db.query(`select status, ready_override_reason from ugc_characters where id = $1`, [id])).rows[0];
  assert.deepEqual([r.status, r.ready_override_reason], ['ready', 'karakter lama yang sudah terbukti stabil']);
});

test('RLS dan hak: tugas hanya terbaca pemilik/admin, staff tidak bisa menulis tugas langsung, agent tidak membaca tabel', async () => {
  const db = await makeDb();
  const id = await newChar(db, { status: 'sheet_ready' }); await addPhoto(db, id);
  await as(db, U.staffA, async () => { await db.query(`select ugc_request_char_task($1, 'upload_photos')`, [id]); });
  await as(db, U.staffA, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_character_tasks`)).rows[0].n, 1);
    await rejects(db.query(`insert into ugc_character_tasks (character_id, kind, created_by) values ($1, 'intro_video', $2)`, [id, U.staffA]), 'permission denied');
    await rejects(db.query(`update ugc_character_tasks set status = 'done'`), 'permission denied');
    await rejects(db.query(`update ugc_character_photos set flow_uploaded_at = now() where character_id = $1`, [id]), '42501');
  });
  await as(db, U.staffB, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_character_tasks`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from ugc_character_photos`)).rows[0].n, 1, 'pustaka foto dibagi');
  });
  await as(db, U.agent, async () => {
    assert.equal((await db.query(`select count(*)::int as n from ugc_character_tasks`)).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int as n from ugc_character_photos`)).rows[0].n, 0);
  });
  for (const t of ['ugc_character_photos', 'ugc_character_tasks']) for (const p of ['select', 'insert', 'truncate']) {
    assert.equal((await db.query(`select has_table_privilege('anon', 'public.${t}', '${p}') as v`)).rows[0].v, false, `anon ${p} ${t}`);
  }
  assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.ugc_character_tasks', 'insert') as v`)).rows[0].v, false);
});

test('konteks tanpa pengguna (service_role/SQL Editor) tidak terblokir penjaga, pengguna biasa tetap terblokir', async () => {
  const db = await makeDb();
  const id = await newChar(db);
  await db.exec(`update ugc_characters set status = 'ready', voice_shared_ok = true where id = '${id}'`);
  assert.equal((await db.query(`select status from ugc_characters where id = $1`, [id])).rows[0].status, 'ready');
  await as(db, U.staffA, async () => { await rejects(db.query(`update ugc_characters set status = 'intro_review' where id = $1`, [id]), '42501'); });
});
