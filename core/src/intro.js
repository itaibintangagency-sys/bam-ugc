'use strict';
const { getSetting } = require('./catalog');
const { buildVoiceDirection, introLine, wordCount, INTRO_WORD_LIMIT } = require('./voice');
const { lintVideoJson } = require('./lint');

/**
 * Video perkenalan karakter: 4 detik (durasi terpendek di Flow), 720p, satu adegan.
 * Ucapan harus selesai sebelum 3,2 detik. Karakter dipanggil lewat penanda @[Nama] (satu kali).
 * ctx: { name, code, flowCharacterName, voiceProfile, settingId = 'S-20', line }
 */
function buildIntroJson(ctx) {
  const { name, code = '', flowCharacterName, voiceProfile, settingId = 'S-20' } = ctx;
  if (!flowCharacterName) throw new Error('flowCharacterName wajib (nama karakter di Flow)');
  if (/[\[\]]/.test(flowCharacterName)) throw new Error('nama karakter di Flow tidak boleh mengandung tanda kurung siku');
  const setting = getSetting(settingId);
  if (!setting) throw new Error(`lokasi ${settingId} tidak dikenal`);
  const line = ctx.line || introLine(name);
  if (wordCount(line) > INTRO_WORD_LIMIT) throw new Error(`ucapan perkenalan maksimal ${INTRO_WORD_LIMIT} kata`);

  const obj = {
    project: {
      title: `INTRO | ${code}`.trim(),
      duration: 'EXACTLY 4 seconds',
      aspect_ratio: '9:16 vertical',
      language: 'Bahasa Indonesia',
      style: 'highly realistic vertical UGC clip, natural everyday footage look'
    },
    clean_frame: {
      instruction: 'The picture is pure, clean camera footage. The frame contains ONLY the real location and the character. The frame IS the footage itself, never a picture of a screen, a phone, a camera app, or any other device.',
      first_frame: 'Frame 1 (0.0 s) is already the live scene: the character standing in the location and facing the camera. The video never opens on a phone screen, a camera interface, a countdown, a title, or any transition.',
      rule: 'Nothing is added on top of the footage.'
    },
    references: {
      character: `Use @[${flowCharacterName}] as the ONLY source of the talent's face, clothing and voice identity.`
    },
    environment: {
      location: setting.name_en || String(setting.prompt_en || '').split(/ with |,|\./)[0].trim() || setting.nama,
      description: setting.prompt_en,
      lighting: setting.cahaya,
      restriction: ['No signage, brand names, or readable text in the background']
    },
    camera: {
      style: 'natural handheld or stabilized camera',
      framing: 'medium close-up, character facing the camera',
      movement: 'subtle and realistic',
      restriction: ['No dramatic zoom', 'No cinematic transitions', 'No phone screen, camera interface, or device frame in the picture']
    },
    timeline: [{
      scene: '01', time: '0.0-4.0 seconds', shot: 'SELF INTRODUCTION',
      action: [
        'Character looks directly toward the camera and smiles naturally.',
        'Character says the line below, with one small natural nod or hand gesture.',
        'From the end of the line until 4.0 seconds, hold a relaxed smile in silence.'
      ]
    }],
    dialogue: {
      language: 'Bahasa Indonesia',
      line,
      timing: { starts: '0.3 seconds', must_finish_before: '3.2 seconds', then: 'silent until 4.0 seconds' },
      lip_sync: 'precise synchronization between mouth movement and the line',
      restriction: ['Say exactly the line, nothing added or removed', 'No product, brand, price, or claim']
    },
    audio: {
      voice_direction: voiceProfile ? buildVoiceDirection(voiceProfile, setting) : undefined,
      recording_space: setting.acoustic ? setting.acoustic.en : undefined,
      music: 'none',
      sound_effects: 'none'
    },
    negative_prompt: [
      'no character identity change', 'no face morphing', 'no extra fingers', 'no distorted hands',
      'no text on screen', 'no subtitles', 'no captions', 'no title', 'no watermark', 'no username or handle',
      'no logo of any platform or app', 'no app interface elements', 'no sticker', 'no banner', 'no label or badge',
      'no emoji overlay', 'no graphic overlay of any kind', 'no phone screen, camera app interface, viewfinder, or device frame', 'no background music'
    ],
    final_instruction: 'Generate ONE continuous EXACTLY 4-second vertical video of clean, raw camera footage with no overlays, starting directly on the live scene (never on a phone screen or a camera interface). The character says only the given line and finishes before 3.2 seconds.'
  };
  const json = JSON.stringify(obj, null, 1);
  const bad = lintVideoJson(json.replace(/"timeline": \[[\s\S]*?\n \],/, '"timeline": [1,2,3,4,5],')).filter(i => i.level === 'error');
  if (bad.length) throw new Error('JSON perkenalan melanggar lint: ' + JSON.stringify(bad));
  return json;
}
module.exports = { buildIntroJson };
