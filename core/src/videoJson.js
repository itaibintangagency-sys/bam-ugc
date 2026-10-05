'use strict';
const { neutralize } = require('./neutralize');
const { buildVoiceDirection } = require('./voice');

const ACTION_BY_ANGLE_HINT = {
  detail: ['Move the camera naturally closer to that exact area.', 'Character gently points to or presents the detail.', 'Keep the rest of the product unchanged.'],
  side: ['Character naturally turns to a three-quarter or side angle.', 'Show the silhouette and how the product naturally falls.', 'No full 360-degree spin.']
};


// Daftar larangan lengkap (bawaan). Butir "phone screen" menangani kasus video yang tampak seperti rekaman layar kamera ponsel.
const FULL_NEGATIVES = [
  'no product redesign', 'no color change', 'no pattern change', 'no invented product details', 'no different product between scenes',
  'no character identity change', 'no face morphing', 'no extra fingers', 'no distorted hands',
  'no text on screen', 'no subtitles', 'no captions', 'no title', 'no lower-third',
  'no watermark', 'no username or handle', 'no logo of any platform or app', 'no app interface elements',
  'no sticker', 'no banner', 'no label or badge', 'no emoji overlay', 'no link icon', 'no arrow or pointer graphic',
  'no graphic overlay of any kind', 'no phone screen, camera app interface, viewfinder, or device frame',
  'no excessive camera movement', 'no dramatic lighting', 'no runway movement'
];
// Versi ringkas untuk uji: butir tentang antarmuka aplikasi dan platform digabung menjadi satu pernyataan positif.
const COMPACT_NEGATIVES = [
  'no product redesign', 'no color change', 'no pattern change', 'no invented product details', 'no different product between scenes',
  'no character identity change', 'no face morphing', 'no extra fingers', 'no distorted hands',
  'pure footage with nothing overlaid on the picture', 'no phone screen, camera app interface, viewfinder, or device frame',
  'no excessive camera movement', 'no dramatic lighting', 'no runway movement'
];

const BEAT_EN = n => (n === 1 ? 'a short natural opening that introduces the product' : n === 5 ? 'a short friendly spoken closing' : 'one short sentence about what this scene shows');

function sceneFromPanel(p) {
  const focus = p.focus_en || p.focus;
  const base = { scene: String(p.n).padStart(2, '0'), time: `${p.time.replace('-', '-')} seconds`, shot: p.shot_en || p.title, framing_and_camera: neutralize(p.angle_prompt), product_focus: focus, dialogue_beat: BEAT_EN(p.n), on_screen_text: 'none' };
  if (p.n === 1) return { ...base, action: ['Show the complete product immediately recognizable.', 'Character looks toward the camera and smiles naturally.', 'Character begins speaking.', 'Use only small natural hand gestures.'] };
  if (p.n === 5) {
    const gesture = p.gesture === 'pointing_down' ? 'Use ONE natural pointing gesture downward.' : 'Use ONE natural open-palm gesture presenting the product toward the camera.';
    return { ...base, action: ['Return naturally to the opening position.', 'Show the complete product one final time.', 'Character looks directly toward the camera and smiles naturally.', gesture, 'The closing invitation is delivered by voice only.', 'Finish all dialogue before 9.2 seconds.', 'From 9.2-10.0 seconds hold the final pose silently.'] };
  }
  const hint = /silu|samping|belakang|sisi|siluet|panjang/i.test(p.title + ' ' + p.slot) ? ACTION_BY_ANGLE_HINT.side : ACTION_BY_ANGLE_HINT.detail;
  return { ...base, action: [`Move the camera in close on: ${focus}. Show it only visually, through camera framing and a small gesture. Never write it as text.`, ...hint], restriction: 'Only feature what exists in the uploaded references.' };
}

/**
 * plan: hasil buildPanelPlan
 * ctx: { characterCode, jobTag, productProfile, compactNegatives?, flowCharacterName?, voiceProfile?, characterProfile?: { appearance_en }, characterPhotoAttached?: boolean }
 */
function buildVideoJson(plan, ctx) {
  const { characterCode = '', jobTag = '', productProfile, flowCharacterName, voiceProfile, characterProfile, characterPhotoAttached = false } = ctx;
  const facts = productProfile.facts_en || productProfile.facts || [];
  const obj = {
    project: {
      title: `${characterCode} | ${jobTag}`.trim(),
      duration: 'EXACTLY 10 seconds',
      aspect_ratio: '9:16 vertical',
      language: 'Bahasa Indonesia',
      style: 'highly realistic vertical UGC product review video, natural everyday footage look'
    },
    clean_frame: {
      instruction: 'The picture is pure, clean camera footage. The frame contains ONLY the real location, the character, and the product. The frame IS the footage itself, never a picture of a screen, a phone, a camera app, or any other device.',
      first_frame: 'Frame 1 (0.0 s) is already the live scene: the character standing in the location and facing the camera. The video never opens on a phone screen, a camera interface, a countdown, a title, or any transition.',
      rule: 'Nothing is added on top of the footage. Any closing invitation exists only as spoken audio. Every description in this prompt is an instruction for you, never text to display: never render any word, label, caption, callout, arrow, or pointer line. Product details are shown only through camera framing and natural gestures.'
    },
    references: {
      character: flowCharacterName
        ? `Use @[${flowCharacterName}] as the ONLY source of the talent's face, complexion, hair and voice identity. Her outfit is NEVER taken from the character: it is only the product from the product references.`
        : characterPhotoAttached
          ? 'A separate close-up portrait photo of the woman is attached. It is the ONLY source of her face, complexion, and hair (color and style). The storyboard document also shows her; if the two differ, the portrait photo wins. Never replace her with a different person. Her outfit is only the product from the product references.'
          : 'The woman shown in the character reference portrait inside the attached storyboard is the ONLY source of the talent identity: face, complexion, hair color, and hairstyle. Never replace her with a different person. Her outfit is only the product from the product references.',
      storyboard: 'The attached storyboard defines the order and timing of the five scenes. If it and the timeline below disagree, the timeline wins.',
      product: 'All product references represent ONE SAME PHYSICAL PRODUCT and are the source of truth, not inspiration.'
    },
    locked_product_facts: facts,
    consistency_lock: {
      character: true, product: true, environment: true, voice: true,
      rule: 'Angle, pose, or close-up changes never regenerate the product. Only natural folds and gravity may vary. If a pose threatens product fidelity, simplify the pose.',
      priority: 'PRODUCT FIDELITY IS MORE IMPORTANT THAN POSE OR VISUAL CREATIVITY.'
    },
    character: {
      character_id: characterCode,
      ...(characterProfile && characterProfile.appearance_en ? { appearance: characterProfile.appearance_en } : {}),
      identity_lock: {
        priority: 'ABSOLUTE',
        preserve: ['same face identity', 'same facial proportions', 'same complexion', 'same hairstyle', 'same hair color', 'same apparent age', 'same overall proportions'],
        restriction: 'Do not copy the face, hair, or appearance of any person shown in the product reference images.'
      },
      expression: 'friendly, cheerful, natural and relatable',
      performance: 'natural creator talking naturally to the camera',
      movement: 'small, relaxed and realistic movements',
      restriction: ['No exaggerated modeling poses', 'No excessive hand movements', 'No identity drift', 'No face morphing']
    },
    environment: {
      location: plan.setting.name_en || plan.setting.name,
      description: plan.setting.prompt_en,
      lighting: plan.setting.lighting,
      continuity: 'Use the exact same location and lighting throughout all scenes.',
      restriction: ['No signage, brand names, or readable text in the background', 'No distracting background objects']
    },
    camera: {
      style: 'natural handheld or stabilized camera',
      movement: 'subtle and realistic',
      restriction: ['No aggressive camera movement', 'No dramatic zoom', 'No orbit shot', 'No 360-degree camera movement', 'No cinematic transitions', 'No phone screen, camera interface, or device frame in the picture']
    },
    timeline: plan.panels.map(sceneFromPanel),
    dialogue: {
      language: 'Bahasa Indonesia',
      voice: 'young Indonesian female voice',
      tone: 'natural, friendly, conversational',
      lip_sync: 'precise synchronization between mouth movement and dialogue',
      script_generation: {
        instruction: 'Create a short Bahasa Indonesia dialogue based ONLY on locked_product_facts and what is clearly visible in the references.',
        structure: {
          '0.0-2.0': 'Short natural opening introducing the product.',
          '2.0-4.0': `Mention: ${plan.panels[1].focus_en || plan.panels[1].focus}.`,
          '4.0-6.0': `Mention: ${plan.panels[2].focus_en || plan.panels[2].focus}.`,
          '6.0-8.0': `Mention: ${plan.panels[3].focus_en || plan.panels[3].focus}.`,
          '8.0-9.2': 'Short friendly spoken closing inviting viewers to check the keranjang kuning. VOICE ONLY: these words are never shown as text or graphics.',
          '9.2-10.0': 'NO DIALOGUE.'
        },
        word_budget: { '0.0-2.0': 5, '2.0-4.0': 5, '4.0-6.0': 5, '6.0-8.0': 5, '8.0-9.2': 4 },
        restriction: ['Do not mention features that cannot be confirmed from the references.', 'Do not invent material, comfort, price, discount, or brand information.']
      }
    },
    audio: {
      voice_direction: voiceProfile ? buildVoiceDirection(voiceProfile, plan.setting) : undefined,
      recording_space: plan.setting.acoustic ? plan.setting.acoustic.en : undefined,
      music: 'soft modern instrumental background music', music_volume: 'low, voice must remain clear', sound_effects: 'minimal or none'
    },
    visual_quality: { style: 'highly realistic', fabric: 'realistic material texture, folds, gravity and movement', hands: 'natural hands with correct fingers', look: 'authentic UGC rather than commercial advertising' },
    negative_prompt: ctx.compactNegatives ? COMPACT_NEGATIVES : FULL_NEGATIVES,
    absolute_final_priority: [
      '1. EXACT PRODUCT FIDELITY TO THE REFERENCES',
      '2. SAME PRODUCT AND CHARACTER FOR ALL 10 SECONDS',
      '3. CLEAN FOOTAGE: NOTHING ADDED ON TOP OF THE PICTURE',
      '4. FOLLOW THE FIVE-SCENE TIMELINE',
      '5. NATURAL UGC PERFORMANCE',
      '6. ACCURATE LIP SYNC',
      '7. SAME LOCATION AND LIGHTING'
    ],
    final_instruction: 'Generate ONE continuous EXACTLY 10-second vertical video of clean, raw camera footage with no overlays, starting directly on the live scene (never on a phone screen or a camera interface). Simplify character or camera movement whenever necessary to preserve product accuracy and character consistency.'
  };
  return JSON.stringify(obj, null, 1);
}

module.exports = { buildVideoJson };
